#!/usr/bin/env node
import Discord, {
    Guild,
    GuildMember,
    Message,
    PartialTextBasedChannelFields,
    Snowflake,
    StringResolvable
} from "discord.js";
import {
    addPingName,
    getAdmins,
    getPingNames,
    getProcessing,
    getRoleMapppings,
    getToken,
    getUserName,
    getUserRoles,
    remPingName,
    setProcessing,
    setRoleMapping,
    setUserName,
    setUserRoles
} from "./db";
import {CommandDescription, desc, descriptions, interpret, OPTIONAL} from "./cmdsupport";
import {dedent} from "./stringsupport";
import moment = require("moment-timezone");
import {COMMAND_PREFIX, createCommands, replyMessage, runCommand, sendMessage} from "./cmds";
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

function tryExecuteCommand(message: Message, commandText: string): boolean {
    // validate post-prefix message
    const potentialCommand = commandText.substring(COMMAND_PREFIX.length);
    if (!CMD_START_RE.test(potentialCommand)) {
        // not a command, abort!
        return false;
    }
    runCommand(message, potentialCommand, getAdmins().indexOf(message.author.id) >= 0, commands);
    return true;
}

client.on('message', message => {
    if (message.author.id === client.user.id) {
        // don't reply-self
        return;
    }
    const text = message.content;
    if (text.startsWith(COMMAND_PREFIX) && tryExecuteCommand(message, text)) {
        return;
    } else if (message.channel.type === 'dm') {
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
