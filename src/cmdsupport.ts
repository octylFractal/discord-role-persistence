import {Client, Guild, Role, Snowflake, User} from "discord.js";
import {RoleFilter} from "./dbwrap";

export type RequiredString = 'REQUIRED' | 'OPTIONAL';

export const REQUIRED = 'REQUIRED';
export const OPTIONAL = 'OPTIONAL';

export interface CommandArgDescriptor {
    validate(arg: string): boolean

    describe(): string

    required: RequiredString
}

export interface RequiredCommandArgDescriptor extends CommandArgDescriptor {
    required: typeof REQUIRED
}

export interface OptionalCommandArgDescriptor extends CommandArgDescriptor {
    required: typeof OPTIONAL
}

export interface ChoiceCommandArgDescriptor extends CommandArgDescriptor {
}

export interface CommandArgDescriptorBuilder {
    r(name: string): RequiredCommandArgDescriptor

    o(name: string): OptionalCommandArgDescriptor

    c(name: string, required: RequiredString, options: string[]): ChoiceCommandArgDescriptor
}

class DescBuilderImpl implements CommandArgDescriptorBuilder {

    c(name: string, required: RequiredString, options: string[]): ChoiceCommandArgDescriptor {
        return {
            validate(arg) {
                return options.indexOf(arg) >= 0;
            },
            describe() {
                const base = `${name}: "${options.join('|')}"`;
                if (required === REQUIRED) {
                    return '<' + base + '>';
                } else {
                    return '[' + base + ']';
                }
            },
            required: required
        };
    }

    o(name: string): OptionalCommandArgDescriptor {
        return {
            validate() {
                return true;
            },
            describe() {
                return `[${name}]`;
            },
            required: OPTIONAL
        };
    }

    r(name: string): RequiredCommandArgDescriptor {
        return {
            validate() {
                return true;
            },
            describe() {
                return `<${name}>`;
            },
            required: REQUIRED
        };
    }

}

export const desc: CommandArgDescriptorBuilder = new DescBuilderImpl();

export enum ValidateState {
    VALID,
    NOT_ENOUGH_ARGS,
    FAILED_ARG_VALIDATION,
    OTHER_ERROR,
}

export interface ValidateResult<V> {
    state: ValidateState
    value: V
}

export interface ValidValidateResult extends ValidateResult<undefined> {
    state: ValidateState.VALID
}

export interface NotEnoughArgsValidateResult extends ValidateResult<number> {
    state: ValidateState.NOT_ENOUGH_ARGS
}

export interface FailedArgValidateResult extends ValidateResult<CommandArgDescriptor> {
    state: ValidateState.FAILED_ARG_VALIDATION
}

export interface OtherValidateResult extends ValidateResult<any> {
    state: ValidateState.OTHER_ERROR
}

// emulate a sealed class, return only this
export type SealedValidateResults =
    ValidValidateResult
    | NotEnoughArgsValidateResult
    | FailedArgValidateResult
    | OtherValidateResult;

export interface CommandDescription {
    args: CommandArgDescriptor[]

    describe(): string

    validate(argv: string[]): SealedValidateResults
}

export function descriptions(...commandDescs: CommandArgDescriptor[]): CommandDescription {
    let foundOptional = false;
    commandDescs.forEach(desc => {
        if (desc.required == REQUIRED && foundOptional) {
            throw new Error("Required argument not allowed after optional argument.");
        } else if (desc.required == OPTIONAL) {
            foundOptional = true;
        }
    });
    return {
        args: commandDescs,
        describe() {
            return this.args.map(arg => arg.describe()).join(" ");
        },
        validate(argv) {
            return validate(argv, this.args);
        }
    };
}

function validate(argv: string[], commandDescs: CommandArgDescriptor[]): SealedValidateResults {
    const requiredArgCount = commandDescs.reduce((acc, val) => acc + (val.required === REQUIRED ? 1 : 0), 0);
    if (argv.length < requiredArgCount) {
        return {
            state: ValidateState.NOT_ENOUGH_ARGS,
            value: requiredArgCount
        };
    }
    argv = argv.slice(0, commandDescs.length);
    for (let i = 0; i < argv.length; i++) {
        const desc = commandDescs[i];
        if (!desc.validate(argv[i])) {
            return {
                state: ValidateState.FAILED_ARG_VALIDATION,
                value: desc
            };
        }
    }
    return {state: ValidateState.VALID, value: undefined};
}

enum InterpretState {
    NORMAL,
    S_QUOTE,
    D_QUOTE
}

export function interpret(cmd: string): string[] {
    const cmdPoints = Array.from(cmd);
    const parts: string[] = [];

    let partBuilder: string[] = [];
    let state: InterpretState = InterpretState.NORMAL;
    let i = 0;
    while (i < cmdPoints.length) {
        const cp = cmdPoints[i];
        i++;
        switch (state) {
            case InterpretState.NORMAL:
                switch (cp) {
                    case ' ':
                        parts.push(partBuilder.join(''));
                        partBuilder = [];
                        break;
                    case "'":
                        state = InterpretState.S_QUOTE;
                        break;
                    case '"':
                        state = InterpretState.D_QUOTE;
                        break;
                    default:
                        partBuilder.push(cp);
                }
                break;
            case InterpretState.S_QUOTE:
                switch (cp) {
                    case '\\':
                        if (cmdPoints[i + 1] === "'") {
                            partBuilder.push("'");
                            i++;
                        } else {
                            partBuilder.push('\\');
                        }
                        break;
                    case "'":
                        state = InterpretState.NORMAL;
                        break;
                    default:
                        partBuilder.push(cp);
                }
                break;
            case InterpretState.D_QUOTE:
                switch (cp) {
                    case '\\':
                        if (cmdPoints[i + 1] === '"') {
                            partBuilder.push('"');
                            i++;
                        } else {
                            partBuilder.push('\\');
                        }
                        break;
                    case '"':
                        state = InterpretState.NORMAL;
                        break;
                    default:
                        partBuilder.push(cp);
                }
                break;
        }
    }

    switch (state) {
        case InterpretState.NORMAL:
            if (partBuilder.length) {
                parts.push(partBuilder.join(''));
            }
            break;
        case InterpretState.S_QUOTE:
        case InterpretState.D_QUOTE:
            throw new Error("Missing quote.");
    }

    return parts;
}


/**
 * Capture text inside parentheses, with the first one at {@code start}.
 */
export function captureInParens(allText: Array<string>, start: number): Array<string> | undefined {
    let numParens = 1;
    let index = start + 1;

    for (; index < allText.length; index++) {
        if (numParens == 0) {
            break;
        }
        if (allText[index] == '(') {
            numParens++;
        } else if (allText[index] == ')') {
            numParens--;
        }
    }

    return allText.slice(start + 1, index - 1);
}

export function indexOfSubseq<T>(array: T[], subseq: T[], from: number): number | undefined {
    function matchesAll(index: number) {
        for (let i = 0; i < subseq.length; i++) {
            if (array[i + index] != subseq[i]) {
                return false;
            }
        }
        return true;
    }

    for (let index = from; index < (array.length - subseq.length); index++) {
        if (matchesAll(index)) {
            return index;
        }
    }
    return undefined;
}

export function requireGuild(guild: Guild | undefined, informUser: (msg: string) => void): guild is Guild {
    if (typeof guild === "undefined") {
        informUser("Error: a guild context is required for this command");
        return false;
    }
    return true;
}

export interface ValidateRolesArgs {
    client: Client,
    gId: Snowflake,
    roleIds: Snowflake[],
    roleFilter?: RoleFilter
    informUser: UserMessageCallback
}

export interface ValidRoles {
    guild: Guild
    roles: Role[]
}

export async function validateRoles({
                                  client, gId, roleIds, roleFilter = () => true, informUser
                              }: ValidateRolesArgs): Promise<ValidRoles | undefined> {
    const guild = client.guilds.cache.get(gId);
    if (typeof guild === "undefined") {
        informUser("Error: bot does not exist in guild");
        return undefined;
    }
    const roles = guild.roles;
    const roleOut: Role[] = [];
    for (const r of roleIds) {
        const role = await roles.fetch(r);
        if (role === null || !roleFilter(r)) {
            informUser(`Warning: role ${r} not found in guild or not visible.`);
            return undefined;
        }
        roleOut.push(role);
    }
    return {guild: guild, roles: roleOut};
}

export function generateRoleList({roles}: ValidRoles): string {
    if (roles.length == 0) {
        return "nothing";
    }
    return roles.map(role => `'${role.name}'`).join(", ");
}

export function undefFilter<T>(t: T | undefined): t is T {
    return typeof t !== "undefined";
}

export function nullFilter<T>(t: T | null): t is T {
    return t !== null;
}

export type PromisedString = string | PromiseLike<string>;
export type UserMessageCallback = (msg: PromisedString) => void;

export function userHumanId(user: User): string {
    return `${user.username}#${user.discriminator}`;
}
