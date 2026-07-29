import { search } from '@inquirer/prompts'
import chalk from 'chalk'
import * as child_process from 'child_process'
import fs from 'node:fs'
import path from 'node:path'

import { getConfig } from '../common/config.ts'
import { log, logError } from '../common/log.ts'

async function openProject(projectDir: string): Promise<void> {
    const absolutePath: string = path.resolve(projectDir)
    const config = await getConfig()

    const command: string = `${config.ide} ${absolutePath}`

    child_process.exec(command, (error) => {
        if (error) {
            logError(`Could not open project: ${error.message}`)
            return
        }
    })
}
export async function open(initialQuery: string | undefined | null): Promise<void> {
    const config = await getConfig()
    if (config.gitDir == null) {
        log(`${chalk.red('Git dir not set, run: ')}${chalk.yellow('tsm config --git-dir=<dir>')}`)
        process.exit(1)
    }

    const files = fs.readdirSync(config.gitDir)
    const perfectMatch = files.find((it) => it === initialQuery)
    if (perfectMatch) {
        const absolutePath = path.resolve(config.gitDir, perfectMatch)
        await openProject(absolutePath)
        return
    }

    const initialSuggestions = files.filter((file) => file.includes(initialQuery || ''))
    const selectedDirectory = await search({
        message: 'Type to filter projects',
        source: (input) => {
            if (input == null || input.trim() === '') {
                return initialSuggestions
            }

            return (initialSuggestions.length === 0 ? files : initialSuggestions)
                .filter((file) => file.includes(input))
                .map((it) => ({
                    name: it,
                    value: it,
                }))
        },
    })

    if (!selectedDirectory) {
        log('No project selected')
        process.exit(1)
    }

    const absolutePath = path.resolve(config.gitDir, selectedDirectory)
    if (fs.existsSync(absolutePath)) {
        log(`Opening ${absolutePath} in IDE...`)
        await openProject(absolutePath)
    } else {
        log(`The path ${absolutePath} doesn't exist.`)
    }
}
