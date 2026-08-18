import * as clack from '@clack/prompts'
import path from 'node:path'

import { CACHE_DIR } from './cache.ts'

export type Author = [name: string, email: string, user: string]

const authorOptions: Author[] = [
    ['Karl O', 'k@rl.run', 'karl'],
    ['Andreas', 'danduras@gmail.com', 'andreassagenaspaas'],
    ['Joakim Taule Kartveit', 'joakimkartveit@gmail.com', 'joakim'],
    ['Helene Arnesen', 'helene.arnesen@nav.no', 'helenearnesen'],
    ['Jørn-Are Flaten', 'ja.flaten91@gmail.com', 'jaflaten'],
    ['Lene Tillerli Omdal', 'lene.omdal@hotmail.com', 'leneomdal'],
    ['Leo-Andreas Ervik', 'leo.ervik@pm.me', 'leoervik'],
    ['Halvor Grizzly Bjørn', 'mrbjoern92@gmail.com', 'mrbjoern'],
    ['Erik Haug', 'erik.haug@nav.no', 'erikhaugnav'],
]

/**
 * Prompts for co-authors, pre-selecting whoever was used last time. Returns null if the user
 * cancels the prompt.
 */
export async function promptForCoAuthors(): Promise<Author[] | null> {
    const previouslyUsedCoAuthors = await getCachedCoAuthors()
    const bonusCoAuthors = await getBonusCoAuthors()
    const combinedAuthorOptions = [...authorOptions, ...bonusCoAuthors]

    const selectable = combinedAuthorOptions.filter(([, , user]) => Bun.env.USER !== user)

    const selectedAuthors = await clack.multiselect({
        message: 'Select co-authors',
        options: selectable.map(([name, email, user]) => ({
            value: [name, email, user] satisfies Author,
            label: name,
        })),
        initialValues: selectable.filter(([name]) =>
            previouslyUsedCoAuthors.some((prev) => name === prev[0]),
        ) as Author[],
        required: true,
    })

    if (clack.isCancel(selectedAuthors)) {
        return null
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
