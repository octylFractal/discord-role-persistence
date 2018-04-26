#!/usr/bin/env node
import Discord, {Guild, GuildMember, Message, Permissions, Snowflake} from "discord.js";
import {
    getAdmins,
    getRoleMapppings,
    getToken,
    getUserName,
    getUserRoles,
    setRoleMapping,
    setUserName,
    setUserRoles
} from "./db";

const client = new Discord.Client();

function getMemTag(member: GuildMember) {
    return `[${member.id}:${member.user.username}@${member.guild.id}:${member.guild.name}]`;
}

function guildMemberUpdate(member: GuildMember) {
    const memTag = getMemTag(member);
    const roles = member.roles.array();
    console.log(memTag, 'Saving roles:', roles.map(r => ({
        id: r.id,
        name: r.name
    })));
    setUserRoles(member.user.id, member.guild.id, roles.map(r => r.id));

    console.log(memTag, 'Saving name:', member.nickname);
    setUserName(member.user.id, member.guild.id, member.nickname);
}

function applyRole(member: GuildMember, roleId: Snowflake): Promise<void> {
    const memTag = getMemTag(member);
    const roleMap = getRoleMapppings(member.guild.id);
    if (roleMap && roleMap[roleId]) {
        console.log(memTag, 'Mapping role', roleId, 'to', roleMap[roleId]);
        roleId = roleMap[roleId];
    }
    let roleObj = member.guild.roles.get(roleId);
    // exclude dropped roles, @everyone, non-existent roles, and managed roles.
    if (roleId === '0' || roleId === member.guild.id || typeof roleObj === "undefined" || roleObj.managed) {
        console.log(memTag, 'Dropping role', roleId);
        return Promise.reject('role dropped');
    }
    return member.addRole(roleId, 'role-persistence: user joined, adding saved roles.')
        .then(() => console.log(memTag, 'Applied', roleId))
        .catch(err => {
            console.error(memTag, 'Failed to add role:', err);
            throw err;
        });
}

function onJoinGuild(guild: Guild) {
    guild.members.forEach(m => guildMemberUpdate(m));
}

client.on('ready', () => {
    console.log('I am ready!');
    client.guilds.forEach(g => onJoinGuild(g));
});

client.on('guildCreate', guild => onJoinGuild(guild));

function onAddRoles(member: GuildMember) {
    const memTag = getMemTag(member);
    const roles = getUserRoles(member.user.id, member.guild.id);
    if (!roles) {
        console.log(memTag, 'No roles detected.');
        return;
    }
    console.log(memTag, 'Found some roles, applying...');
    roles.forEach(r => {
        applyRole(member, r)
            .then(() => {}, () => {});
    });
}

function onAddName(member: GuildMember) {
    if (!member.guild.member(client.user.id).hasPermission('MANAGE_NICKNAMES')) {
        return;
    }
    const memTag = getMemTag(member);
    const name = getUserName(member.user.id, member.guild.id);
    if (!name) {
        console.log(memTag, 'No name detected.');
        return;
    }
    console.log(memTag, 'Found a name, applying...');
    member.setNickname(name, 'role-persistence: user joined, adding saved name')
        .then(() => {
            console.log(memTag, "Applied name!");
        })
        .catch(err => {
            console.log(memTag, "Failed to apply name", err);
        });
}

client.on('guildMemberAdd', member => {
    const memTag = getMemTag(member);
    console.log(memTag, 'Joined guild.');

    onAddRoles(member);
    onAddName(member);
});

client.on('guildMemberUpdate', (old, member) => {
    guildMemberUpdate(member);
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
    gibrole(message: Message, argv: string[]) {
        // gibrole [gid] [uid] [roles...]
        if (argv.length <= 3) {
            replyMessage(message, "Error: 3 arguments required.");
            return;
        }
        const [gid, uid, ...roleIds] = argv.slice(1);
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
        if (message.channel.type === 'dm') {
            // bonus treats
            replyMessage(message, `Oh hai ${message.author.username}!`);
        }
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
