#!/usr/bin/env node
import Discord, {Guild, GuildMember, Snowflake} from "discord.js";
import lowdb from "lowdb";
import FileSync from "lowdb/adapters/FileSync";

const client = new Discord.Client();

const adapter = new FileSync('db.json');
const db = lowdb(adapter);

db.defaults({
    roleMap: {}
});

function setUserRoles(uid: Snowflake, gid: Snowflake, roles: Snowflake[]) {
    db.set(['roleMap', gid, uid], roles).write();
}

function getUserRoles(uid: Snowflake, gid: Snowflake): Snowflake[] {
    return db.get(['roleMap', gid, uid]).value();
}

function getMemTag(member: GuildMember) {
    return `[${member.id}:${member.user.username}@${member.guild.id}:${member.guild.name}]`;
}

function setRolesFromGuildMember(member: GuildMember) {
    const memTag = getMemTag(member);
    // The role with an ID === guild ID is the @everyone role
    // Don't try to hand it out!
    // Also don't save managed roles...
    const roles = member.roles.array()
        .filter(r => r.id !== member.guild.id)
        .filter(r => !r.managed);
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
    // update individually?
    roles.forEach(r => {
        member.addRole(r, 'role-persistence: user joined, adding saved roles.')
            .then(() => console.log(memTag, 'Applied!'))
            .catch(err => console.error(memTag, 'Failed to add role:', err));
    });
});

client.on('guildMemberUpdate', (old, member) => {
    setRolesFromGuildMember(member);
});

client.login('NDM2MDY5MzM5MjgwNDQxMzQ0.DbiIyA._-JkV8Np_hwAluhrvHajvDtbWBs')
    .catch(e => console.error('log in error!', e));
