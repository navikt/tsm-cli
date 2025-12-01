import path from 'node:path'

import chalk from 'chalk'

import { log } from '../../common/log.ts'
import { getConfig, updateConfig } from '../../common/config.ts'
import { CACHE_DIR } from '../../common/cache.ts'

export async function getIgnoreList(search: string): Promise<string[]> {
    const config = await getConfig()
    if (config.searchIgnoreLists == undefined) return []
    const ignoreList = config.searchIgnoreLists[search]
    if (!ignoreList) return []
    const ignoreFile = Bun.file(path.join(CACHE_DIR, ignoreList))
    if (!(await ignoreFile.exists())) {
        log(chalk.red(`File ${ignoreFile} does not exist, removing`))
        delete config.searchIgnoreLists[search]
        await updateConfig(config)
        return []
    }
    return (await ignoreFile.text()).split('\n')
}

async function saveIgnoreList(search: string, ignoreList: string[]): Promise<void> {
    const config = await getConfig()
    const filename = config.searchIgnoreLists[search] ?? crypto.randomUUID().toString()
    const ignoreFile = Bun.file(path.join(CACHE_DIR, filename))
    if (ignoreList.length === 0) {
        delete config.searchIgnoreLists[search]
        if (await ignoreFile.exists()) await ignoreFile.delete()
    } else {
        config.searchIgnoreLists[search] = filename
        await Bun.write(ignoreFile, ignoreList.join('\n'))
    }
    await updateConfig(config)
}

export async function addToIgnoreList(search: string, value: string): Promise<void> {
    const ignoreList = await getIgnoreList(search)
    if (ignoreList.includes(value)) {
        log(chalk.yellow(`include list for ${search} already included ${value}`))
    } else {
        log(`Adding ${value} to ${search} ignore list`)
        ignoreList.push(value)
        await saveIgnoreList(search, ignoreList)
    }
}

export async function deleteFromIgnoreList(search: string, value: string): Promise<void> {
    const ignoreList = await getIgnoreList(search)
    if (!ignoreList.includes(value)) {
        log(`Ignorelist for ${search} does not include this ${value} `)
    }
    ignoreList.splice(ignoreList.indexOf(value), 1)
    await saveIgnoreList(search, ignoreList)
}

export async function resetIgnoreList(search: string): Promise<void> {
    const config = await getConfig()
    if (!config.searchIgnoreLists[search]) {
        log(`No ignorelist for ${search} found`)
    }
    delete config.searchIgnoreLists[search]
    await updateConfig(config)
}
