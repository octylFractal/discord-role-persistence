#!/usr/bin/env node
import Discord, {Guild, GuildMember, Message} from "discord.js";
import {getAdmins, getRoleMapppings, getToken, getUserRoles, setRoleMapping, setUserRoles} from "./db";

const client = new Discord.Client();

function getMemTag(member: GuildMember) {
    return `[${member.id}:${member.user.username}@${member.guild.id}:${member.guild.name}]`;
}

function setRolesFromGuildMember(member: GuildMember) {
    const memTag = getMemTag(member);
    const roles = member.roles.array();
    console.log(memTag, 'Saving roles:', roles.map(r => ({
        id: r.id,
        name: r.name
    })));
    setUserRoles(member.user.id, member.guild.id, roles.map(r => r.id));
}

function onJoinGuild(guild: Guild) {
    guild.members.forEach(m => setRolesFromGuildMember(m));
}

client.on('ready', () => {
    console.log('I am ready!');
    client.guilds.forEach(g => onJoinGuild(g));
});

client.on('guildCreate', guild => onJoinGuild(guild));

client.on('guildMemberAdd', member => {
    const memTag = getMemTag(member);
    console.log(memTag, 'Joined guild.');

    const roles = getUserRoles(member.user.id, member.guild.id);
    if (!roles) {
        console.log(memTag, 'No roles detected.');
        return;
    }
    console.log(memTag, 'Found some roles, applying...');
    const roleMap = getRoleMapppings(member.guild.id);
    roles.forEach(r => {
        if (roleMap[r]) {
            console.log(memTag, 'Mapping role', r, 'to', roleMap[r]);
            r = roleMap[r];
        }
        let roleObj = member.guild.roles.get(r);
        // exclude dropped roles, @everyone, non-existent roles, and managed roles.
        if (r === '0' || r === member.guild.id || typeof roleObj === "undefined" || roleObj.managed) {
            console.log(memTag, 'Dropping role', r);
            return;
        }
        member.addRole(r, 'role-persistence: user joined, adding saved roles.')
            .then(() => console.log(memTag, 'Applied', r))
            .catch(err => console.error(memTag, 'Failed to add role:', err));
    });
});

client.on('guildMemberUpdate', (old, member) => {
    setRolesFromGuildMember(member);
});

function isAdminDm(message: Message) {
    return message.channel.type === 'dm' && getAdmins().indexOf(message.author.id) >= 0;
}

function replyMessage(message: Message, reply: string) {
    message.reply(reply)
        .catch(err => console.warn('Error sending reply', err));
}

type Command = (message: Message, argv: string[]) => void;

const commands: { [k: string]: Command } = {
    maprole(message: Message, argv: string[]) {
        if (argv.length <= 3) {
            replyMessage(message, 'Error: 3 arguments required.');
            return;
        }
        const [gid, from, to] = argv.slice(1);
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
    },
    guilds(message: Message) {
        replyMessage(message, 'Guilds:');
        replyMessage(message, client.guilds.sort((a, b) => a.name.localeCompare(b.name)).map(g => `${g.name} (${g.id})`).join('\n'));
    },
    roles(message: Message, argv) {
        if (argv.length <= 1) {
            replyMessage(message, "Error: 1 argument required.");
            return;
        }
        const gid = argv[1];
        const guild = client.guilds.get(gid);
        if (typeof guild === "undefined") {
            replyMessage(message, "Error: bot does not exist in guild");
            return;
        }
        replyMessage(message, 'Roles:');
        replyMessage(message, guild.roles.sort((a, b) => a.name.localeCompare(b.name)).map(r => `${r.name} (${r.id})`).join('\n'));
    },
    help(message) {
        replyMessage(message, 'Commands:');
        for (let k of Object.keys(commands)) {
            replyMessage(message, '!' + k);
        }
    }
};


client.on('message', message => {
    if (message.author.id === client.user.id) {
        // don't reply-self
        return;
    }
    if (!isAdminDm(message)) {
        replyMessage(message, `Oh hai ${message.author.username}!`);
        return;
    }
    const text = message.content;
    if (!text.startsWith('!')) {
        replyMessage(message, `Good day, mistress ${message.author.username}.`);
        return;
    }
    const argv = text.substring(1).split(' ');
    console.log('EXEC', argv);
    const cmd = commands[argv[0]];
    if (typeof cmd === "undefined") {
        replyMessage(message, "Error: unknown command.");
        return;
    }
    cmd(message, argv);
});

client.login(getToken())
    .catch(e => console.error('log in error!', e));
