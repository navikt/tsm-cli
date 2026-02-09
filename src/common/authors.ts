import path from 'node:path'

import chalk from 'chalk'
import { checkbox } from '@inquirer/prompts'

import { CACHE_DIR } from './cache.ts'
import { log } from './log.ts'

export type Author = [name: string, email: string, user: string]

const authorOptions: Author[] = [
    ['Karl O', 'k@rl.run', 'karl'],
    ['Andreas', 'danduras@gmail.com', 'andreassagenaspaas'],
    ['Natalie Uranes', 'natalie.uranes@gmail.com', 'natalieu'],
    ['Joakim Taule Kartveit', 'joakimkartveit@gmail.com', 'joakim'],
    ['Helene Arnesen', 'helene.arnesen@nav.no', 'helenearnesen'],
    ['Jørn-Are Flaten', 'ja.flaten91@gmail.com', 'jaflaten'],
    ['Lene Tillerli Omdal', 'lene.omdal@hotmail.com', 'leneomdal'],
    ['Leo-Andreas Ervik', 'leo.ervik@pm.me', 'leoervik'],
    ['Halvor Grizzly Bjørn', 'mrbjoern92@gmail.com', 'mrbjoern'],
    ['Erik Haug', 'erik.haug@nav.no', 'erikhaugnav'],
]

export async function promptForCoAuthors(): Promise<Author[]> {
    const previouslyUsedCoAuthors = await getCachedCoAuthors()
    const bonusCoAuthors = await getBonusCoAuthors()
    const combinedAuthorOptions = [...authorOptions, ...bonusCoAuthors]

    const selectedAuthors: Author[] = await checkbox({
        message: 'Select co-authors',
        choices: combinedAuthorOptions
            .filter(([, , user]) => Bun.env.USER !== user)
            .map(([name, email, user]) => ({
                name: `${name.split(' ')[0]}`,
                value: [name, email, user] satisfies Author,
                checked: previouslyUsedCoAuthors?.find((prev) => name === prev[0]) != null,
            })),
        pageSize: 15,
    })

    if (selectedAuthors.length === 0) {
        log(chalk.red('You must select at least one co-author'))
        return promptForCoAuthors()
    }

    await cacheCoAuthors(selectedAuthors)

    return selectedAuthors
}

export function createCoAuthorsText(authors: Author[]): string {
    return authors.map(([name, email]) => `Co-authored-by: ${name} <${email}>`).join('\n')
}

async function cacheCoAuthors(authors: Author[]): Promise<void> {
    const coAuthorsFile = Bun.file(path.join(CACHE_DIR, 'co-authors.json'))

    await Bun.write(coAuthorsFile, JSON.stringify(authors))
}

async function getCachedCoAuthors(): Promise<Author[]> {
    const coAuthorsFile = Bun.file(path.join(CACHE_DIR, 'co-authors.json'))

    if (await coAuthorsFile.exists()) {
        return coAuthorsFile.json()
    }

    return []
}

async function getBonusCoAuthors(): Promise<Author[]> {
    const bonusCoAuthorsFile = Bun.file(path.join(CACHE_DIR, 'bonus-co-authors.json'))

    if (await bonusCoAuthorsFile.exists()) {
        return bonusCoAuthorsFile.json()
    }

    return []
}
