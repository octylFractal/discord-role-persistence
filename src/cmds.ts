import {
    CommandDescription,
    desc,
    descriptions,
    generateRoleList,
    interpret,
    nullFilter,
    OPTIONAL,
    REQUIRED,
    requireGuild,
    userHumanId,
    UserMessageCallback,
    validateRoles,
    ValidateState
} from "./cmdsupport";
import {addPingName, getUnmoderatedRoles, remPingName, setRoleMapping, setUnmoderatedRoles} from "./db";
import {Client, Guild, Message, PartialTextBasedChannelFields, Snowflake, StringResolvable} from "discord.js";
import {applyRole, getMemTag, getRoleFilter, removeRole, unmoderatedRoleFilter} from "./dbwrap";
import moment = require("moment-timezone");

export const COMMAND_PREFIX = '.';

export async function sendMessage(target: PartialTextBasedChannelFields, message: StringResolvable) {
    await target.send(message).catch(err => console.warn('Error sending message to', target, err));
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
    guild: Guild | undefined,
    argv: string[],
    isAdmin: boolean,

    informUser: UserMessageCallback
}

interface Command {
    requiresAdmin: boolean
    description: CommandDescription

    run(commandArgs: CommandArgs): void | Promise<void>
}

const FORMAT_ARG_TABLE: Record<string, string> = {
    'default': HUMAN_FORMAT,
    'am/pm': HUMAN_FORMAT_AM_PM
};

type UserContexts = Record<Snowflake, UserContext | undefined>;

export interface CommandStore {
    commands: Record<string, Command>;
    userContexts: UserContexts;
}

export interface UserContext {
    guildId: Snowflake
}


export function createCommands(client: Client): CommandStore {
    const userContext: Record<Snowflake, UserContext | undefined> = {};

    // shared command implementations:
    function manageUserRoles({message, guild, argv: [uid, action, ...roleIds], isAdmin, informUser}: CommandArgs) {
        if (!requireGuild(guild, informUser)) {
            return;
        }
        const validation = validateRoles({
            client: client,
            gId: guild.id,
            roleIds: roleIds,
            roleFilter: getRoleFilter(guild.id, isAdmin),
            informUser: informUser
        });
        if (typeof validation === "undefined") {
            return;
        }

        const member = guild.member(uid);
        if (member === null) {
            informUser(`Error: unknown user ${uid}.`);
            return;
        }

        switch (action) {
            case 'add':
                for (const r of roleIds) {
                    const msg = applyRole(member, r, 'user ' + userHumanId(message.author) + ' requested change')
                        .then(() => `Applied role ${r}.`)
                        .catch(err => `Couldn't apply ${r}: ${err}`);
                    informUser(msg);
                }
                return;
            case 'remove':
                for (const r of roleIds) {
                    const msg = removeRole(member, r, 'user ' + userHumanId(message.author) + ' requested change')
                        .then(() => `Removed role ${r}.`)
                        .catch(err => `Couldn't remove ${r}: ${err}`);
                    informUser(msg);
                }
                return;
            default:
                informUser(`Error: unknown action ${action}.`);
                return;
        }
    }

    const commands: Record<string, Command> = {
        'set-guild-id': {
            requiresAdmin: false,
            description: descriptions(
                desc.r('guildId')
            ),
            run({message, argv: [gId], informUser}) {
                if (!client.guilds.cache.has(gId)) {
                    informUser("Error: bot is not in that guild.");
                    return;
                }
                const authId = message.author.id;
                userContext[authId] = {
                    ...userContext[authId],
                    guildId: gId
                };
                informUser(`Your contextual guild ID is now ${gId}.`);
            }
        },
        'map-role': {
            requiresAdmin: true,
            description: descriptions(
                desc.r('fromRole'),
                desc.r('toRole')
            ),
            async run({guild, argv: [from, to], informUser}) {
                if (!requireGuild(guild, informUser)) {
                    return;
                }
                const [fromResolved, toResolved] = await Promise.all([
                    guild.roles.fetch(from),
                    guild.roles.fetch(to),
                ]);
                if (fromResolved === null) {
                    informUser("Error: `from` role does not exist in guild");
                    return;
                }
                if (toResolved === null && to !== '0') {
                    informUser("Error: `to` role does not exist in guild");
                    return;
                }
                setRoleMapping(guild.id, from, to);
                informUser("Mapped roles successfully!");
            }
        },
        guilds: {
            requiresAdmin: true,
            description: descriptions(),
            run({informUser}) {
                informUser('Guilds:');
                informUser(client.guilds.cache
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(g => `${g.name} (${g.id})`)
                    .join('\n'));
            }
        },
        roles: {
            requiresAdmin: false,
            description: descriptions(
            ),
            run({guild, isAdmin, informUser}) {
                if (!requireGuild(guild, informUser)) {
                    return;
                }
                const roleFilter = isAdmin ? () => true : unmoderatedRoleFilter(guild.id);
                const filteredRoles = guild.roles.cache
                    .filter(role => roleFilter(role.id));
                if (filteredRoles.size == 0) {
                    informUser('There are no roles visible to you.');
                    return;
                }
                informUser('Roles:');
                const roles = filteredRoles
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(r => `\`${r.name}\` (${r.id})`);
                roles.forEach(informUser);
            }
        },
        'unmoderated-roles': {
            requiresAdmin: true,
            description: descriptions(
                desc.c('action', REQUIRED, ['add', 'remove', 'list']),
                desc.o('roleIds...')
            ),
            async run({guild, argv: [action, ...roleIds], isAdmin, informUser}) {
                if (!requireGuild(guild, informUser)) {
                    return;
                }
                const validation = await validateRoles({
                    client: client,
                    gId: guild.id,
                    roleIds: roleIds,
                    roleFilter: getRoleFilter(guild.id, isAdmin),
                    informUser: informUser
                });
                if (typeof validation === "undefined") {
                    return;
                }

                const roleList = generateRoleList(validation);
                let unmodRoles = getUnmoderatedRoles(guild.id);
                switch (action) {
                    case 'add':
                        unmodRoles = unmodRoles.concat(roleIds);
                        informUser(`Added ${roleList} to unmoderated roles.`);
                        break;
                    case 'remove':
                        const removeSet = new Set(roleIds);
                        unmodRoles = unmodRoles.filter(role => removeSet.has(role));
                        informUser(`Removed ${roleList} from unmoderated roles.`);
                        break;
                    case 'list':
                        console.log("listing roles")
                        informUser(`Current unmoderated roles:`);

                        const resolvedRoles = await Promise.all(unmodRoles.map(roleId => guild.roles.fetch(roleId)));
                        const roles = resolvedRoles
                            .filter(nullFilter)
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map(r => `\`${r.name}\` (${r.id})`);
                        roles.forEach(informUser);
                        return;
                    default:
                        informUser(`Error: unknown action \`${action}\`.`);
                        return;
                }
                setUnmoderatedRoles(guild.id, unmodRoles);
            }
        },
        'role-admin': {
            requiresAdmin: true,
            description: descriptions(
                desc.r('userId'),
                desc.c('action', REQUIRED, ['add', 'remove']),
                desc.r('roleIds...'),
            ),
            run: manageUserRoles
        },
        'role': {
            requiresAdmin: false,
            description: descriptions(
                desc.c('action', REQUIRED, ['add', 'remove']),
                desc.r('roleIds...'),
            ),
            run(commandArgs) {
                const {argv, message} = commandArgs;
                manageUserRoles({
                    ...commandArgs,
                    argv: [message.author.id].concat(argv)
                });
            }
        },
        'ping-name': {
            requiresAdmin: true,
            description: descriptions(
                desc.c('action', "REQUIRED", ['add', 'remove']),
                desc.r('name')
            ),
            run({argv: [action, name], informUser}) {
                switch (action) {
                    case 'add':
                        addPingName(name);
                        informUser(`Added ${name}.`);
                        break;
                    case 'remove':
                        remPingName(name);
                        informUser(`Removed ${name}.`);
                        break;
                    default:
                        informUser(`Error: unknown action ${action}.`);
                }
            }
        },
        time: {
            requiresAdmin: false,
            description: descriptions(
                desc.c('format', OPTIONAL, ['default', 'am/pm'])
            ),
            run({argv: [format = 'default'], informUser}) {
                informUser(`The current time in CA is ${californiaTime(FORMAT_ARG_TABLE[format])}.`);
                informUser(`The current time in NM is ${newMexicoTime(FORMAT_ARG_TABLE[format])}.`);
            }
        },
        'time-convert': {
            requiresAdmin: false,
            description: descriptions(
                desc.r('sourceTime (HH:mm or HH:mm[ap])'),
                desc.r('conversion (CA/NM, NM/CA, etc.)'),
                desc.c('format', OPTIONAL, ['default', 'am/pm'])
            ),
            run({argv: [sourceTime, conversion, format = 'default'], informUser}) {
                const [sourceArea, targetArea] = conversion.split('/');
                const sourceTimeArea = getUserInputTimeArea(sourceArea);
                if (typeof sourceTimeArea === "undefined") {
                    informUser('Invalid `conversion` source.');
                    return;
                }
                const targetTimeArea = getUserInputTimeArea(targetArea);
                if (typeof targetTimeArea === "undefined") {
                    informUser('Invalid `conversion` target.');
                    return;
                }
                const timeMoment = readSourceTime(sourceTime, sourceTimeArea);
                if (typeof sourceTime === "undefined") {
                    informUser('Invalid `sourceTime`.');
                    return;
                }

                const sourceTimeFormatted = time(sourceTimeArea, FORMAT_ARG_TABLE[format], timeMoment);
                const targetTimeFormatted = time(targetTimeArea, FORMAT_ARG_TABLE[format], timeMoment);
                informUser(`${sourceTimeFormatted} in ${sourceTimeArea.name} is `
                    + `${targetTimeFormatted} in ${targetTimeArea.name}.`)
            }
        },
        help: {
            requiresAdmin: false,
            description: descriptions(),
            async run({message, isAdmin}) {
                const auth = message.author;
                const reply: String[] = ['Commands:'];
                for (let k of Object.keys(commands)) {
                    const cmd = commands[k];
                    if (cmd.requiresAdmin && !isAdmin) {
                        continue;
                    }
                    let cmdDesc = `\`${COMMAND_PREFIX}${k} ${cmd.description.describe()}\``;
                    if (cmd.requiresAdmin) {
                        cmdDesc += ` -- requires ${client.user!!.username} admin!`
                    }
                    reply.push(cmdDesc);
                }
                await auth.send(reply.join('\n'));
            }
        }
    };
    return {
        commands: commands,
        userContexts: userContext
    };
}

function validateCommand(cmd: Command, {argv, informUser}: CommandArgs): boolean {
    const validationResult = cmd.description.validate(argv);
    switch (validationResult.state) {
        case ValidateState.VALID:
            return true;
        case ValidateState.NOT_ENOUGH_ARGS:
            informUser('Not enough arguments, expected ' + validationResult.value);
            return false;
        case ValidateState.FAILED_ARG_VALIDATION:
            informUser('Invalid value for argument `' + validationResult.value.describe() + '`');
            return false;
        case ValidateState.OTHER_ERROR:
            informUser('Error: ' + validationResult.value);
            return false;
        default:
            return false;
    }
}

type ComputeGuildValid = { type?: undefined, guild?: Guild };
type ComputeGuildError = { type: "error", error: string };

function computeGuild(userCtxs: UserContexts, message: Message): ComputeGuildValid | ComputeGuildError {
    switch (message.channel.type) {
        case 'dm':
            const ctx = userCtxs[message.author.id];
            if (typeof ctx === "undefined") {
                return {};
            }
            const guildId = ctx.guildId;
            if (typeof guildId === "undefined") {
                return {};
            }
            const guild = message.client.guilds.cache.get(guildId);
            if (typeof guild === "undefined") {
                return {type: "error", error: `The bot is not part of ${guildId}.`};
            }
            return {guild: guild};
        case 'text':
            return {guild: message.guild === null ? undefined : message.guild};
        default:
            return {type: "error", error: `Unknown channel type: ${message.channel.type}.`};
    }
}

export async function runCommand(
    message: Message,
    commandText: string,
    admin: boolean,
    commandStore: CommandStore,
    informUser: UserMessageCallback) {
    const argv = interpret(commandText);
    const memTag = message.channel.type == 'text'
        ? getMemTag(message.member!!)
        : `[${message.author.id}:${message.author.username}]`;
    console.log(memTag, 'EXEC', argv);
    const cmd = commandStore.commands[argv[0]];
    if (typeof cmd === "undefined") {
        informUser("Error: unknown command.");
        return;
    }
    if (cmd.requiresAdmin && !admin) {
        informUser("Error: this command requires FUR-E admin privileges (not server)");
        return;
    }
    const slicedArgs = argv.slice(1);

    const computeGuildResult = computeGuild(commandStore.userContexts, message);

    if (computeGuildResult.type === "error") {
        informUser(`Error: ${computeGuildResult.error}`);
        return;
    }

    const cmdArgs: CommandArgs = {
        message: message,
        guild: computeGuildResult.guild,
        argv: slicedArgs,
        isAdmin: admin,
        informUser: informUser
    };
    if (!validateCommand(cmd, cmdArgs)) {
        return;
    }
    await cmd.run(cmdArgs);
}
