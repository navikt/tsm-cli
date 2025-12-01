import path from 'node:path'
import fs from 'node:fs'

import chalk from 'chalk'

import { CACHE_DIR } from './cache.ts'
import { log } from './log.ts'
import { updateTeamsCache } from './cache/team.ts'

export const CONFIG_DIR = path.join(Bun.env.HOME ?? '~', '.config', 'tsm')

// Dumbly just create the cache dir, we don't care, same as cache dir
fs.mkdirSync(CONFIG_DIR, { recursive: true })
// Migrate config from cache dir to config dir for a little while
await migrateFromCacheToConfigDir(CACHE_DIR, CONFIG_DIR)

type Config = {
    team: string
    gitDir: string | undefined
    ide: string | undefined
    searchIgnoreLists: Record<string, string>
}

const defaultConfig:
    | (Omit<Config, 'team'> & Partial<Pick<Config, 'team'>>)
    | (Omit<Config, 'searchIgnoreLists'> & Partial<Pick<Config, 'searchIgnoreLists'>>) = {
    team: undefined,
    gitDir: undefined,
    ide: 'idea',
    searchIgnoreLists: {},
}

export async function updateConfig(config: Partial<Config>): Promise<Config> {
    const currentConfig: Config = await getConfig()
    const newConfig = { ...currentConfig, ...config }

    const configFile = Bun.file(path.join(CONFIG_DIR, 'config.json'))
    await Bun.write(configFile, JSON.stringify(newConfig))

    await updateTeamsCache(newConfig.team)

    return newConfig
}

export async function getConfig(): Promise<Config> {
    let config: Config

    const configFile = Bun.file(path.join(CONFIG_DIR, 'config.json'))
    if (!(await configFile.exists())) {
        config = defaultConfig as Config
        await Bun.write(configFile, JSON.stringify(defaultConfig))
    } else {
        config = await configFile.json()
    }

    if (!config.ide) {
        config.ide = 'idea'
        await Bun.write(configFile, JSON.stringify(config))
    }

    return config
}

export async function getTeam(): Promise<string> {
    const config = await getConfig()

    if (!config.team) {
        throw new Error('Team is not configured')
    }

    return config.team
}

export async function isTeamConfigured(): Promise<boolean> {
    const configFile = Bun.file(path.join(CONFIG_DIR, 'config.json'))
    const fileExists = await configFile.exists()

    if (!fileExists) return false

    const config: { team: string | undefined } = await configFile.json()
    return config.team != null
}

export async function migrateFromCacheToConfigDir(cacheDir: string, configDir: string): Promise<void> {
    const configInCacheDir = path.join(cacheDir, 'config.json')
    const cacheConfigFile = Bun.file(configInCacheDir)
    if (await cacheConfigFile.exists()) {
        log(chalk.blue('\n...Found config in cache dir, migrating to config dir. This is a one-time-thing. :)\n'))
        const cacheConfigContent: Config = await cacheConfigFile.json()
        const newConfigFile = Bun.file(path.join(configDir, 'config.json'))
        await Bun.write(newConfigFile, JSON.stringify(cacheConfigContent))
        fs.unlinkSync(configInCacheDir)
    }
}
