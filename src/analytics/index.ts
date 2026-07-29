import { updateGlobalAnalytics } from './analytics-global.ts'
import { updateAnalyticsCache } from './analytics.ts'
import { usageDiff } from './diff.ts'
import { Args, Command } from './types.ts'

export async function updateAnalytics(command: Command[], args?: Args): Promise<void> {
    const commandsDiff = usageDiff(command, args)

    await updateAnalyticsCache(commandsDiff)
    await updateGlobalAnalytics(commandsDiff)
}
