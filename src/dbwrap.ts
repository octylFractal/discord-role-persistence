import {GuildMember, Snowflake} from "discord.js";
import {getProcessing, getRoleMapppings, getUnmoderatedRoles, setUserName, setUserRoles} from "./db";

export function getMemTag(member: GuildMember) {
    return `[${member.id}:${member.user.username}@${member.guild.id}:${member.guild.name}]`;
}

export function guildMemberUpdate(member: GuildMember) {
    const memTag = getMemTag(member);
    if (getProcessing(member.user.id, member.guild.id)) {
        console.log(memTag, 'Processing member, skipping updates...');
        return;
    }

    const roles = member.roles.cache.array();
    console.log(memTag, 'Saving roles:', roles.map(r => ({
        id: r.id,
        name: r.name
    })));
    setUserRoles(member.user.id, member.guild.id, roles.map(r => r.id));

    const nickname = member.nickname;
    // extra undefined check while https://github.com/discordjs/discord.js/issues/4640 is open
    if (nickname !== undefined && nickname !== null) {
        console.log(memTag, 'Saving name:', nickname);
        setUserName(member.user.id, member.guild.id, nickname);
    }
}

export type RoleFilter = (roleId: Snowflake) => boolean;

export function applyRole(member: GuildMember, roleId: Snowflake, reason: string): Promise<void> {
    const memTag = getMemTag(member);

    return member.roles.add(roleId, 'role-persistence: ' + reason)
        .then(() => console.log(memTag, 'Applied', roleId))
        .catch(err => {
            console.error(memTag, 'Failed to add role:', err);
            throw err;
        });
}

export function removeRole(member: GuildMember, roleId: Snowflake, reason: string): Promise<void> {
    const memTag = getMemTag(member);

    return member.roles.remove(roleId, 'role-persistence: ' + reason)
        .then(() => console.log(memTag, 'Removed', roleId))
        .catch(err => {
            console.error(memTag, 'Failed to remove role:', err);
            throw err;
        });
}

export async function applyRoleForRejoin(member: GuildMember, roleId: Snowflake): Promise<void> {
    const memTag = getMemTag(member);
    const roleMap = getRoleMapppings(member.guild.id);
    if (roleMap && roleMap[roleId]) {
        console.log(memTag, 'Mapping role', roleId, 'to', roleMap[roleId]);
        roleId = roleMap[roleId];
    }
    let roleObj = await member.guild.roles.fetch(roleId);
    // exclude these roles:
    if (
        // dropped role:
        roleId === '0'
        // @everyone role:
        || roleId === member.guild.id
        // non-existent role:
        || roleObj === null
        // managed role:
        || roleObj.managed
    ) {
        console.log(memTag, 'Dropping role', roleId);
        return Promise.reject('role dropped');
    }
    return applyRole(member, roleId, 'user joined, adding saved roles');
}

export function getRoleFilter(gid: Snowflake, admin: boolean): RoleFilter {
    return admin ? () => true : unmoderatedRoleFilter(gid);
}

export function unmoderatedRoleFilter(gid: Snowflake): RoleFilter {
    const unmodRoles = new Set(getUnmoderatedRoles(gid));
    return roleId => unmodRoles.has(roleId);
}
