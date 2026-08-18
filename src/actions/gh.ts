import { search } from '@inquirer/prompts'
import chalk from 'chalk'

import { clearReposCache } from '../common/cache/repos-cache.ts'
import { getTeam } from '../common/config.ts'
import { log } from '../common/log.ts'
import { openUrl } from '../common/open-url.ts'
import { getAllRepos } from '../common/repos.ts'

export async function openRepoWeb(initialTerm: string | null, noCache: true | undefined): Promise<void> {
    const repos = await getRepoNames(!noCache)

    const perfectMatch = repos.find((it) => it === initialTerm)
    if (perfectMatch != null) {
        await openRepo(perfectMatch)
        return
    }

    const initialFilter = repos.filter((name) => name.includes(initialTerm ?? ''))
    if (initialFilter.length === 1) {
        await openRepo(initialFilter[0])
        return
    }

    const item = await search({
        message: 'Which repo do you want to open in browser?',
        source: (term) =>
            repos.filter((name) => name.includes(term ?? initialTerm ?? '')).map((name) => ({ name, value: name })),
    })

    await openRepo(item)
}

async function getRepoNames(cache: boolean = true): Promise<string[]> {
    if (!cache) clearReposCache()

    const team = await getTeam()
    const repos = await getAllRepos(team)

    return repos.map((it) => it.name)
}

async function openRepo(repo: string): Promise<void> {
    log(`Opening ${chalk.green(`${repo} on github.com...`)}`)
    await openUrl(`https://github.com/navikt/${repo}`)
}
