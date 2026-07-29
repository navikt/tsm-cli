import path from 'node:path'

import { CACHE_DIR } from '../common/cache.ts'

import { applyDiff } from './diff.ts'
import { Usage, UserCommandUsage } from './types.ts'

export async function updateAnalyticsCache(diff: Usage): Promise<void> {
    const cachedAnalytics = await loadCachedAnalytics()
    const updatedCachedAnalytics = applyDiff(diff, cachedAnalytics)

    await saveCachedAnalytics(updatedCachedAnalytics)
}

async function loadCachedAnalytics(): Promise<UserCommandUsage> {
    const cachedAnalytics = Bun.file(path.join(CACHE_DIR, 'analytics.json'))
    if (!(await cachedAnalytics.exists())) return { user: Bun.env.USER ?? 'unknown', usage: {} }

    return await cachedAnalytics.json()
}

async function saveCachedAnalytics(updated: UserCommandUsage): Promise<void> {
    const cachedAnalytics = Bun.file(path.join(CACHE_DIR, 'analytics.json'))
    await Bun.write(cachedAnalytics, JSON.stringify(updated))
}
