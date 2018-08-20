import {GuildMember, Snowflake} from "discord.js";
import {getProcessing, getRoleMapppings, setUserName, setUserRoles} from "./db";

export function getMemTag(member: GuildMember) {
    return `[${member.id}:${member.user.username}@${member.guild.id}:${member.guild.name}]`;
}

export function guildMemberUpdate(member: GuildMember) {
    const memTag = getMemTag(member);
    if (getProcessing(member.user.id, member.guild.id)) {
        console.log(memTag, 'Processing member, skipping updates...');
        return;
    }

    const roles = member.roles.array();
    console.log(memTag, 'Saving roles:', roles.map(r => ({
        id: r.id,
        name: r.name
    })));
    setUserRoles(member.user.id, member.guild.id, roles.map(r => r.id));

    console.log(memTag, 'Saving name:', member.nickname);
    setUserName(member.user.id, member.guild.id, member.nickname);
}

export function applyRole(member: GuildMember, roleId: Snowflake): Promise<void> {
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