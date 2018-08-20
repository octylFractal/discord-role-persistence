import {CommandDescription, desc, descriptions, interpret, OPTIONAL, ValidateState} from "./cmdsupport";
import {addPingName, remPingName, setRoleMapping} from "./db";
import {dedent} from "./stringsupport";
import {Client, Message, PartialTextBasedChannelFields, StringResolvable} from "discord.js";
import {applyRole, getMemTag} from "./dbwrap";
import moment = require("moment-timezone");

export function replyMessage(message: Message, reply: string) {
    message.reply(reply)
        .catch(err => console.warn('Error sending reply', err));
}

export function sendMessage(target: PartialTextBasedChannelFields, message: StringResolvable) {
    target.send(message).catch(err => console.warn('Error sending message to', target, err));
}

const HUMAN_FORMAT = 'HH:mm, MMM Do, YYYY';
const HUMAN_FORMAT_AM_PM = 'hh:mm a, MMM Do, YYYY';

interface TimeArea {
    name: string
    timeZone: string
    sourceNames: string[]
}

const TimeAreas: Record<string, TimeArea> = {
    CALIFORNIA: {
        name: 'California',
        timeZone: 'America/Los_Angeles',
        sourceNames: [
            'ca',
            'california',
            'cali',
        ]
    },
    NEW_MEXICO: {
        name: 'New Mexico',
        timeZone: 'America/Denver',
        sourceNames: [
            'nm',
            'new mexico'
        ]
    }
};
const keys: (keyof typeof TimeAreas)[] = Object.keys(TimeAreas) as any;

function getUserInputTimeArea(sourceArea: string): TimeArea | undefined {
    const lowerArea = sourceArea.toLowerCase();
    for (const timeAreaKey of keys) {
        let timeArea = TimeAreas[timeAreaKey];
        const options = timeArea.sourceNames;

        if (options.some(v => v === lowerArea)) {
            return timeArea;
        }
    }
    return undefined;
}

function time(tz: TimeArea, format: string = HUMAN_FORMAT, time?: Date | moment.Moment) {
    return moment.tz(time || new Date(), tz.timeZone).format(format);
}

function californiaTime(format?: string) {
    return time(TimeAreas.CALIFORNIA, format);
}

function newMexicoTime(format?: string) {
    return time(TimeAreas.NEW_MEXICO, format)
}

const SOURCE_TIME_FORMATS = [
    'H:mm',
    'HH:mm',
    'h:mma',
    'h:mmA',
    'hh:mma',
    'hh:mmA',
    'H',
    'HH',
    'ha',
    'hA'
];

function readSourceTime(time: string, sourceArea: TimeArea): moment.Moment {
    return moment.tz(time, SOURCE_TIME_FORMATS, true, sourceArea.timeZone);
}

interface CommandArgs {
    message: Message,
    argv: string[],
    isAdmin: boolean
}

interface Command {
    requiresAdmin: boolean
    description: CommandDescription

    run(commandArgs: CommandArgs): void
}

const FORMAT_ARG_TABLE: Record<string, string> = {
    'default': HUMAN_FORMAT,
    'am/pm': HUMAN_FORMAT_AM_PM
};

export type CommandStore = Record<string, Command>;

export function createCommands(client: Client): CommandStore {
    const commands: CommandStore = {
        'map-role': {
            requiresAdmin: true,
            description: descriptions(
                desc.r('groupId'),
                desc.r('fromRole'),
                desc.r('toRole')
            ),
            run({message, argv: [gid, from, to]}) {
                const guild = client.guilds.get(gid);
                if (typeof guild === "undefined") {
                    replyMessage(message, "Error: bot does not exist in guild");
                    return;
                }
                const roles = guild.roles;
                if (!roles.has(from)) {
                    replyMessage(message, "Error: `from` role does not exist in guild");
                    return;
                }
                if (!roles.has(to) && to !== '0') {
                    replyMessage(message, "Error: `to` role does not exist in guild");
                    return;
                }
                setRoleMapping(gid, from, to);
                replyMessage(message, "Mapped roles successfully!");
            }
        },
        guilds: {
            requiresAdmin: true,
            description: descriptions(),
            run({message}) {
                replyMessage(message, 'Guilds:');
                replyMessage(message, client.guilds.sort((a, b) => a.name.localeCompare(b.name)).map(g => `${g.name} (${g.id})`).join('\n'));
            }
        },
        roles: {
            requiresAdmin: true,
            description: descriptions(
                desc.r('groupId')
            ),
            run({message, argv: [gid]}) {
                const guild = client.guilds.get(gid);
                if (typeof guild === "undefined") {
                    replyMessage(message, "Error: bot does not exist in guild");
                    return;
                }
                replyMessage(message, 'Roles:');
                replyMessage(message, guild.roles.sort((a, b) => a.name.localeCompare(b.name)).map(r => `${r.name} (${r.id})`).join('\n'));
            }
        },
        'give-role': {
            requiresAdmin: true,
            description: descriptions(
                desc.r('groupId'),
                desc.r('userId'),
                desc.r('roleIds...')
            ),
            run({message, argv: [gid, uid, ...roleIds]}) {
                const guild = client.guilds.get(gid);
                if (typeof guild === "undefined") {
                    replyMessage(message, "Error: bot does not exist in guild");
                    return;
                }
                const roles = guild.roles;
                for (const r of roleIds) {
                    if (!roles.has(r)) {
                        replyMessage(message, `Warning: role ${r} not found in guild.`);
                        return;
                    }
                }

                const member = guild.member(uid);
                if (typeof member === "undefined") {
                    replyMessage(message, `Error: unknown user ${uid}.`)
                }

                for (const r of roleIds) {
                    applyRole(member, r)
                        .then(() => replyMessage(message, `Applied role ${r}.`))
                        .catch(err => replyMessage(message, `Couldn't apply ${r}: ${err}`));
                }
            }
        },
        'ping-name': {
            requiresAdmin: true,
            description: descriptions(
                desc.c('action', "REQUIRED", ['add', 'remove']),
                desc.r('name')
            ),
            run({message, argv: [action, name]}) {
                switch (action) {
                    case 'add':
                        addPingName(name);
                        replyMessage(message, `Added ${name}.`);
                        break;
                    case 'remove':
                        remPingName(name);
                        replyMessage(message, `Removed ${name}.`);
                        break;
                    default:
                        replyMessage(message, `Error: unknown action ${action}.`);
                }
            }
        },
        time: {
            requiresAdmin: false,
            description: descriptions(
                desc.c('format', OPTIONAL, ['default', 'am/pm'])
            ),
            run({message, argv: [format = 'default']}) {
                sendMessage(message.channel, dedent(`
            The current time in CA is ${californiaTime(FORMAT_ARG_TABLE[format])}.
            The current time in NM is ${newMexicoTime(FORMAT_ARG_TABLE[format])}.
            `))
            }
        },
        'time-convert': {
            requiresAdmin: false,
            description: descriptions(
                desc.r('sourceTime (HH:mm or HH:mm[ap])'),
                desc.r('conversion (CA/NM, NM/CA, etc.)'),
                desc.c('format', OPTIONAL, ['default', 'am/pm'])
            ),
            run({message, argv: [sourceTime, conversion, format = 'default']}) {
                const [sourceArea, targetArea] = conversion.split('/');
                const sourceTimeArea = getUserInputTimeArea(sourceArea);
                if (typeof sourceTimeArea === "undefined") {
                    sendMessage(message.channel, 'Invalid `conversion` source.');
                    return;
                }
                const targetTimeArea = getUserInputTimeArea(targetArea);
                if (typeof targetTimeArea === "undefined") {
                    sendMessage(message.channel, 'Invalid `conversion` target.');
                    return;
                }
                const timeMoment = readSourceTime(sourceTime, sourceTimeArea);
                if (typeof sourceTime === "undefined") {
                    sendMessage(message.channel, 'Invalid `sourceTime`.');
                    return;
                }

                const sourceTimeFormatted = time(sourceTimeArea, FORMAT_ARG_TABLE[format], timeMoment);
                const targetTimeFormatted = time(targetTimeArea, FORMAT_ARG_TABLE[format], timeMoment);
                sendMessage(message.channel,
                    `${sourceTimeFormatted} in ${sourceTimeArea.name} is `
                    + `${targetTimeFormatted} in ${targetTimeArea.name}.`)
            }
        },
        help: {
            requiresAdmin: false,
            description: descriptions(),
            run({message, isAdmin}) {
                const auth = message.author;
                const reply: String[] = ['Commands:'];
                for (let k of Object.keys(commands)) {
                    const cmd = commands[k];
                    if (cmd.requiresAdmin && !isAdmin) {
                        continue;
                    }
                    let cmdDesc = `\`!${k} ${cmd.description.describe()}\``;
                    if (cmd.requiresAdmin) {
                        cmdDesc += ` -- requires ${client.user.username} admin!`
                    }
                    reply.push(cmdDesc);
                }
                auth.send(reply.join('\n'));
            }
        }
    };
    return commands;
}

function validateCommand(cmd: Command, argv: string[], message: Message): boolean {
    const validationResult = cmd.description.validate(argv);
    switch (validationResult.state) {
        case ValidateState.VALID:
            return true;
        case ValidateState.NOT_ENOUGH_ARGS:
            replyMessage(message, 'Not enough arguments, expected ' + validationResult.value);
            return false;
        case ValidateState.FAILED_ARG_VALIDATION:
            replyMessage(message, 'Invalid value for argument `' + validationResult.value.describe() + '`');
            return false;
        case ValidateState.OTHER_ERROR:
            replyMessage(message, 'Error: ' + validationResult.value);
            return false;
        default:
            return false;
    }
}

export function runCommand(message: Message, admin: boolean, commands: CommandStore) {
    const text = message.content;
    const argv = interpret(text.substring(1));
    const memTag = message.channel.type == 'text'
        ? getMemTag(message.member)
        : `[${message.author.id}:${message.author.username}]`;
    console.log(memTag, 'EXEC', argv);
    const cmd = commands[argv[0]];
    if (typeof cmd === "undefined") {
        replyMessage(message, "Error: unknown command.");
        return;
    }
    if (cmd.requiresAdmin && !admin) {
        replyMessage(message, "Error: this command requires FUR-E admin privileges (not server)");
        return;
    }
    const slicedArgs = argv.slice(1);
    if (!validateCommand(cmd, slicedArgs, message)) {
        return;
    }
    cmd.run({
        message: message,
        argv: slicedArgs,
        isAdmin: admin
    });
}