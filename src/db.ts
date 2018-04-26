#!/usr/bin/env node
import {Snowflake} from "discord.js";
import lowdb from "lowdb";
import FileSync from "lowdb/adapters/FileSync";

const adapter = new FileSync('db.json');
const db = lowdb(adapter);

db.defaults({
    roleMap: {},
    roleMappings: {},
    nameMap: {},
    admins: [],
    token: ''
}).write();

export function setUserRoles(uid: Snowflake, gid: Snowflake, roles: Snowflake[]) {
    db.set(['roleMap', gid, uid], roles).write();
}

export function getUserRoles(uid: Snowflake, gid: Snowflake): Snowflake[] {
    return db.get(['roleMap', gid, uid]).value();
}

export function setUserName(uid: Snowflake, gid: Snowflake, name: string) {
    db.set(['nameMap', gid, uid], name).write();
}

export function getUserName(uid: Snowflake, gid: Snowflake): string | undefined {
    return db.get(['nameMap', gid, uid]).value();
}

export function setRoleMapping(gid: Snowflake, fromId: Snowflake, toId: Snowflake) {
    db.set(['roleMappings', gid, fromId], toId).write();
}

export function getRoleMapppings(gid: Snowflake): {[k: string]: string} {
    return db.get(['roleMappings', gid]).value();
}

export function getAdmins(): Snowflake[] {
    return db.get('admins').value();
}

export function getToken(): string {
    return db.get('token').value();
}
