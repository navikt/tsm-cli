// oxlint-disable typescript/restrict-template-expressions

import * as R from 'remeda'

import { Args, Command, CommandUsage, Usage, UserCommandUsage } from './types.ts'

export function usageDiff(command: Command[], args?: Args): Usage {
    const joinedCommand = command.join(':')
    return {
        [joinedCommand]: {
            usage: 1,
            argsUsage: R.pipe(
                args ?? ({} satisfies Args),
                R.entries(),
                R.map(([key, value]) => `${key}:${value}`),
                R.map((key): [string, number] => [key, 1]),
                R.fromEntries(),
            ),
        },
    }
}

export function applyDiff(usage: Usage, existing: UserCommandUsage): UserCommandUsage {
    return {
        user: existing.user,
        usage: {
            ...existing.usage,
            ...R.pipe(
                usage,
                R.entries(),
                R.map(([commandKey, value]): [string, CommandUsage] => [
                    commandKey,
                    {
                        usage: value.usage + (existing.usage[commandKey]?.usage ?? 0),
                        argsUsage: {
                            ...existing.usage[commandKey]?.argsUsage,
                            ...R.pipe(
                                value.argsUsage,
                                R.entries(),
                                R.map(([key, value]): [string, number] => [
                                    key,
                                    value + (existing.usage[commandKey]?.argsUsage[key] ?? 0),
                                ]),
                                R.fromEntries(),
                            ),
                        },
                    },
                ]),
                R.fromEntries(),
            ),
        },
    }
}
