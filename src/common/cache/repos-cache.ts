import chalk from 'chalk'
import { formatDistanceStrict } from 'date-fns'
import fs from 'node:fs'
import path from 'node:path'

import { CACHE_DIR } from '../cache.ts'
import { log, logError } from '../log.ts'

const THREE_HOURS_MS = 3 * 60 * 60 * 1000

const CACHE_FILE_PREFIX = 'repos-cache-'

type CacheEntry<Repo> = {
    /** Epoch millis of when the repos were fetched */
    timestamp: number
    repos: Repo[]
}

/**
 * When true, every repo lookup in this process will hit the network and re-populate the cache.
 * Toggled by `tsm repos --force`.
 */
let forceRefetch = false

export function setForceRefetch(force: boolean): void {
    forceRefetch = force
}

function cacheFile(key: string): string {
    return path.join(CACHE_DIR, `${CACHE_FILE_PREFIX}${key}.json`)
}

/**
 * Fetches repos through a 3 hour file cache. The cache is bypassed when `tsm repos --force` is used.
 *
 * @param key unique cache key, e.g. `all-<team>`
 * @param description human readable description of what is fetched, e.g. `all active repositories for team tsm`
 */
export async function withReposCache<Repo>(
    key: string,
    description: string,
    fetcher: () => Promise<Repo[]>,
): Promise<Repo[]> {
    if (!forceRefetch) {
        const cached = await readReposCache<Repo>(key)
        if (cached != null) {
            const age = formatDistanceStrict(cached.timestamp, Date.now())
            log(chalk.green(`Using cached ${description} (fetched ${age} ago, run 'tsm repos --force' to refresh)`))

            return cached.repos
        }
    }

    log(chalk.green(`Getting ${description}...`))

    const repos = await fetcher()
    await writeReposCache(key, repos)

    return repos
}

async function readReposCache<Repo>(key: string): Promise<CacheEntry<Repo> | null> {
    try {
        const file = Bun.file(cacheFile(key))
        if (!(await file.exists())) return null

        const entry: CacheEntry<Repo> = await file.json()
        if (entry?.timestamp == null || !Array.isArray(entry.repos)) return null
        if (Date.now() - entry.timestamp > THREE_HOURS_MS) return null

        return entry
    } catch (e) {
        logError('Error loading cached repos', e)
        return null
    }
}

async function writeReposCache<Repo>(key: string, repos: Repo[]): Promise<void> {
    try {
        const entry: CacheEntry<Repo> = { timestamp: Date.now(), repos }
        await Bun.write(cacheFile(key), JSON.stringify(entry))
    } catch (e) {
        logError('Error saving cached repos', e)
    }
}

/**
 * Drops every cached repo list, causing the next lookup to hit github.
 */
export function clearReposCache(): void {
    try {
        for (const file of fs.readdirSync(CACHE_DIR)) {
            if (file.startsWith(CACHE_FILE_PREFIX)) {
                fs.rmSync(path.join(CACHE_DIR, file), { force: true })
            }
        }
    } catch (e) {
        logError('Error clearing repos cache', e)
    }
}
