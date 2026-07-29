import { $ } from 'bun'
import chalk from 'chalk'
import * as R from 'remeda'

import { GIT_CACHE_DIR } from '../common/cache.ts'
import { getTeam } from '../common/config.ts'
import { getUpdatedGitterCache } from '../common/git.ts'
import { log } from '../common/log.ts'
import { getAllRepos } from '../common/repos.ts'

async function queryRepo(query: string, repo: string): Promise<boolean> {
    const result = await $`${{ raw: query }}`.cwd(`${GIT_CACHE_DIR}/${repo}`).quiet().throws(false)

    return result.exitCode === 0
}

export async function queryForRelevantRepos(query: string): Promise<void> {
    const team = await getTeam()
    const repos = await getAllRepos(team)
    await getUpdatedGitterCache(repos)

    if (!query) {
        throw new Error('Missing query')
    }

    const relevantRepos = R.pipe(
        await Promise.all(repos.map(async (it) => [it, await queryRepo(query, it.name)] as const)),
        R.filter(([, result]) => result),
        R.map(([name]) => name),
    )

    log(`The following ${chalk.green('repos')} match the query ${chalk.yellow(query)}:`)
    log(relevantRepos.map((it) => ` - ${it.name} (${it.url})`).join('\n'))
}
