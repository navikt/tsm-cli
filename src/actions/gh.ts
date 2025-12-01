import path from 'node:path'

import chalk from 'chalk'
import { search } from '@inquirer/prompts'

import { CACHE_DIR } from '../common/cache.ts'
import { log, logError } from '../common/log.ts'
import { getTeam } from '../common/config.ts'
import { openUrl } from '../common/open-url.ts'
import { getAllRepos } from '../common/repos.ts'
import { BaseRepoNode } from '../common/octokit.ts'

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
    const team = await getTeam()
    if (!cache) {
        return await getAllRepos(team).then((repos) => {
            saveCachedRepos(repos)

            return repos.map((it) => it.name)
        })
    }

    upgradeCacheInBackground(team)

    const cachedRepos = await loadCachedRepos()
    if (cachedRepos.length > 0) return cachedRepos

    log(chalk.blueBright('No cached repos found, fetching and populating cache... Next time will be faster :-)'))
    return await getAllRepos(team).then((repos) => {
        saveCachedRepos(repos)

        return repos.map((it) => it.name)
    })
}

function upgradeCacheInBackground(team: string): void {
    getAllRepos(team).then((repos) => saveCachedRepos(repos))
}

async function loadCachedRepos(): Promise<string[]> {
    try {
        const team = await getTeam()
        const cachedRepos = Bun.file(path.join(CACHE_DIR, `repos-${team}.json`))
        if (!(await cachedRepos.exists())) return []

        return await cachedRepos.json()
    } catch (e) {
        logError('Error loading cached repos', e)
        return []
    }
}

async function saveCachedRepos(repos: BaseRepoNode<unknown>[]): Promise<void> {
    const team = await getTeam()
    const repoNames = repos.map((it) => it.name)

    const cachedRepos = Bun.file(path.join(CACHE_DIR, `repos-${team}.json`))
    await Bun.write(cachedRepos, JSON.stringify(repoNames))
}

async function openRepo(repo: string): Promise<void> {
    log(`Opening ${chalk.green(`${repo} on github.com...`)}`)
    await openUrl(`https://github.com/navikt/${repo}`)
}
