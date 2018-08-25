#!/usr/bin/env node
import Discord, {Guild, GuildMember, Message} from "discord.js";
import {getAdmins, getPingNames, getToken, getUserName, getUserRoles, setProcessing} from "./db";
import {captureInParens, indexOfSubseq} from "./cmdsupport";
import {COMMAND_PREFIX, createCommands, runCommand, sendMessage} from "./cmds";
import {applyRole, getMemTag, guildMemberUpdate} from "./dbwrap";

const client = new Discord.Client();


function onJoinGuild(guild: Guild) {
    guild.members.forEach(m => guildMemberUpdate(m));
}

client.on('ready', () => {
    console.log('I am ready!');
    client.guilds.forEach(g => onJoinGuild(g));
});

client.on('guildCreate', guild => onJoinGuild(guild));

function onAddRoles(member: GuildMember): Promise<any> {
    const memTag = getMemTag(member);
    const roles = getUserRoles(member.user.id, member.guild.id);
    if (!roles) {
        console.log(memTag, 'No roles detected.');
        return Promise.resolve();
    }
    console.log(memTag, 'Found some roles, applying...');
    return Promise.all(roles.map(r => {
        return applyRole(member, r)
            .then(() => {
            }, () => {
            });
    }));
}

function onAddName(member: GuildMember): Promise<void> {
    if (!member.guild.member(client.user.id).hasPermission('MANAGE_NICKNAMES')) {
        return Promise.resolve();
    }
    const memTag = getMemTag(member);
    const name = getUserName(member.user.id, member.guild.id);
    if (!name) {
        console.log(memTag, 'No name detected.');
        return Promise.resolve();
    }
    console.log(memTag, 'Found a name, applying...');
    return member.setNickname(name, 'role-persistence: user joined, adding saved name')
        .then(() => {
            console.log(memTag, "Applied name!");
        })
        .catch(err => {
            console.log(memTag, "Failed to apply name", err);
        });
}

function processAddMember(member: GuildMember) {
    setProcessing(member.user.id, member.guild.id, true);

    const promises: Promise<any>[] = [];
    promises.push.apply(promises, onAddRoles(member));
    promises.push(onAddName(member));

    Promise.all(promises)
        .then(() => setProcessing(member.user.id, member.guild.id, false));
}

client.on('guildMemberAdd', member => {
    const memTag = getMemTag(member);
    console.log(memTag, 'Joined guild.');
    processAddMember(member);
});

client.on('guildMemberUpdate', (old, member) => {
    guildMemberUpdate(member);
});


const commands = createCommands(client);
const CMD_START_RE = /^[a-zA-Z]/;
type CommandsByName = Record<string, string>;

function callCommand(message: Message, commandText: string, commandOutput: (msg: string) => void) {
    runCommand(message,
        commandText,
        getAdmins().indexOf(message.author.id) >= 0,
        commands,
        commandOutput);
}

// inline commands format: (@<name>:<PREFIX><COMMAND + ARGS>)
const INLINE_CMD_START = Array.from("(@");

function extractCommandAtStart(text: string): string | undefined {
    if (!text.startsWith(COMMAND_PREFIX)) {
        return undefined;
    }
    const command = text.substring(COMMAND_PREFIX.length);
    return CMD_START_RE.test(command) ? command : undefined;
}

function extractCommands(text: string): CommandsByName {
    const cmdAtStart = extractCommandAtStart(text);
    if (typeof cmdAtStart !== "undefined") {
        return {'': cmdAtStart};
    }

    let lastParenIndex = 0;
    const commands: CommandsByName = {};
    const textPoints = Array.from(text);

    while (true) {
        const parenIndex = indexOfSubseq(textPoints, INLINE_CMD_START, lastParenIndex);
        if (typeof parenIndex === "undefined") {
            return commands;
        }

        const parenCap = captureInParens(textPoints, parenIndex);
        lastParenIndex = parenIndex + 1;
        if (typeof parenCap === "undefined") {
            continue;
        }
        const indexOfColon = parenCap.indexOf(':');
        if (indexOfColon < 0) {
            console.log("No : in", parenCap);
            continue;
        }
        // slice from @ to :
        const name = parenCap.slice(1, indexOfColon).join('').trim();
        if (name.length == 0) {
            console.log("Name too small in", parenCap);
            continue;
        }
        // slice from : to end
        const commandText = parenCap.slice(indexOfColon + 1).join('').trim();
        const command = extractCommandAtStart(commandText);
        if (typeof command === "undefined") {
            console.log("No command in", commandText, "or", parenCap);
            continue;
        }
        lastParenIndex = parenIndex + parenCap.length + 2;
        commands[name] = command;
    }
}

function execAllCommands(message: Message, commands: CommandsByName) {
    const replyMessage: String[] = [];
    for (const cmdName of Object.keys(commands)) {
        const cmd = commands[cmdName];

        function commandOutput(msg: string) {
            const fullMessage = cmdName ? `@${cmdName}: ${msg}` : msg;
            replyMessage.push(fullMessage);
        }

        callCommand(message, cmd, commandOutput);
    }
    sendMessage(message.channel, replyMessage.join('\n'));
}


client.on('message', message => {
    if (message.author.id === client.user.id) {
        // don't reply-self
        return;
    }
    const text = message.content;
    const commands = extractCommands(text);
    execAllCommands(message, commands);
    const executedCommands = Object.keys(commands).length > 0;
    if (!executedCommands && message.channel.type === 'dm') {
        // bonus treats
        sendMessage(message.channel, `Oh hai ${message.author.username}!`);
        return;
    } else if (message.channel.type === "text") {
        if (!message.member.hasPermission('MENTION_EVERYONE', false, true, true)) {
            return;
        }
        const pingRoles = getPingNames();
        const matches = message.mentions.roles.filter(r => pingRoles.indexOf(r.name) >= 0)
            .filter(r => r.members.has(client.user.id))
            .array();
        if (matches.length) {
            message.channel
                .send(`Listen up ${matches[0].name}, ${message.member.displayName} has something really important to say! (@everyone)`)
                .catch(err => console.error("Error @everyone'in", err));
        }
    }
});

client.login(getToken())
    .catch(e => console.error('log in error!', e));
