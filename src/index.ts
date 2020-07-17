#!/usr/bin/env node
import Discord, {Guild, GuildMember, Message, PartialGuildMember} from "discord.js";
import {getAdmins, getPingNames, getToken, getUserName, getUserRoles, setProcessing} from "./db";
import {captureInParens, indexOfSubseq, UserMessageCallback} from "./cmdsupport";
import {COMMAND_PREFIX, createCommands, runCommand, sendMessage} from "./cmds";
import {applyRoleForRejoin, getMemTag, guildMemberUpdate} from "./dbwrap";

const client = new Discord.Client({
    partials: ['CHANNEL', 'GUILD_MEMBER', 'MESSAGE', 'USER']
});


async function onJoinGuild(guild: Guild) {
    console.log('Joined guild', guild.name, `(${guild.id})`);
    const members = await guild.members.fetch();
    members.forEach(m => guildMemberUpdate(m));
}

client.on('ready', () => {
    console.log('I am ready!');
    Promise.all(client.guilds.cache.map(guild => onJoinGuild(guild)))
        .catch(err => console.warn(err));
});

client.on('guildCreate', guild => onJoinGuild(guild).catch(err => console.warn(err)));

async function onAddRoles(member: GuildMember): Promise<any[]> {
    const memTag = getMemTag(member);
    const roles = getUserRoles(member.user.id, member.guild.id);
    if (!roles) {
        console.log(memTag, 'No roles detected.');
        return [];
    }
    console.log(memTag, 'Found some roles, applying...');
    return Promise.all(roles.map(r => {
        return applyRoleForRejoin(member, r)
            .then(() => {
            }, () => {
            });
    }));
}

function onAddName(member: GuildMember): Promise<void> {
    if (!member.guild.member(client.user!!.id)!!.hasPermission('MANAGE_NICKNAMES')) {
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

    Promise.all([onAddRoles(member), onAddName(member)])
        .then(() => setProcessing(member.user.id, member.guild.id, false))
        .catch(err => console.warn(err));
}

async function unpartializeMember(member: GuildMember | PartialGuildMember): Promise<GuildMember> {
    if (member.partial) {
        return member.fetch();
    }
    return member;
}

async function onGuildMemberAdd(member: GuildMember | PartialGuildMember) {
    member = await unpartializeMember(member);
    const memTag = getMemTag(member);
    console.log(memTag, 'Joined guild.');
    processAddMember(member);
}

client.on('guildMemberAdd', member => {
    onGuildMemberAdd(member).catch(err => console.warn(err));
});

client.on('guildMemberUpdate', (old, member) => {
    unpartializeMember(member)
        .then(member => guildMemberUpdate(member))
        .catch(err => console.warn(err));
});


const commands = createCommands(client);
const CMD_START_RE = /^[a-zA-Z]/;
type CommandsByName = Record<string, string>;

async function callCommand(message: Message, commandText: string, commandOutput: UserMessageCallback) {
    await runCommand(message,
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

async function execAllCommands(message: Message, commands: CommandsByName) {
    const replyMessage: Promise<string>[] = [];
    for (const cmdName of Object.keys(commands)) {
        const cmd = commands[cmdName];

        const commandOutput: UserMessageCallback = function (msg) {
            const fullMessage = Promise.resolve(msg)
                .then(m => cmdName ? `@${cmdName}: ${m}` : m);
            replyMessage.push(fullMessage);
        };

        await callCommand(message, cmd, commandOutput);
    }
    if (replyMessage.length > 0) {
        let messages: string[]
        try {
            messages = await Promise.all(replyMessage);
        } catch (e) {
            console.error("Error waiting for messages", e);
            return;
        }
        await sendMessage(message.channel, messages.join('\n'));
    }
}


async function onMessage(message: Discord.Message) {
    if (message.author.id === client.user?.id) {
        // don't reply-self
        return;
    }
    const text = message.content;
    const commands = extractCommands(text);
    await execAllCommands(message, commands);
    const executedCommands = Object.keys(commands).length > 0;
    if (!executedCommands && message.channel.type === 'dm') {
        // bonus treats
        await sendMessage(message.channel, `Oh hai ${message.author.username}!`);
        return;
    } else if (message.channel.type === "text") {
        if (!message.member?.hasPermission('MENTION_EVERYONE', {
            checkAdmin: true,
            checkOwner: true,
        })) {
            return;
        }
        const pingRoles = getPingNames();
        const matches = message.mentions.roles.filter(r => pingRoles.indexOf(r.name) >= 0)
            .filter(r => r.members.has(client.user!.id))
            .array();
        if (matches.length) {
            try {
                await message.channel
                    .send(`Listen up ${matches[0].name}, ${message.member.displayName} has something really important to say! (@everyone)`);
            } catch (e) {
                console.error("Error @everyone'in", e);
            }
        }
    }
}

client.on('message', message => {
    onMessage(message).catch(err => console.warn("Error in onMessage", err))
});

client.login(getToken())
    .catch(e => console.error('log in error!', e));
