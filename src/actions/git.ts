/* eslint-disable @typescript-eslint/no-explicit-any */

import chalk from 'chalk'

import { getTeam } from '../common/config.ts'
import { Gitter } from '../common/git.ts'
import { log, logProgressDot } from '../common/log.ts'
import {
    BaseRepoNode,
    BaseRepoNodeFragment,
    ghGqlQuery,
    OrgTeamRepoResult,
    removeIgnoredAndArchived,
} from '../common/octokit.ts'

const reposQuery = /* GraphQL */ `
    query ($team: String!) {
        organization(login: "navikt") {
            team(slug: $team) {
                repositories(orderBy: { field: PUSHED_AT, direction: DESC }) {
                    nodes {
                        ...BaseRepoNode
                    }
                }
            }
        }
    }

    ${BaseRepoNodeFragment}
`

async function getAllRepos(): Promise<BaseRepoNode<unknown>[]> {
    const team = await getTeam()

    log(chalk.green(`Getting all active repositories for team ${team}...`))

    const result = await ghGqlQuery<OrgTeamRepoResult<unknown>>(reposQuery, { team })

    return removeIgnoredAndArchived(result.organization.team.repositories.nodes)
}

export async function pullAllRepositories(gitDir: string): Promise<void> {
    const gitter = new Gitter({ type: 'user-config', dir: gitDir })
    const allRepos = await getAllRepos()

    log(chalk.green(`Updating ${allRepos.length} repositories...`))
    logProgressDot()
    setTimeout(() => logProgressDot(), 250)
    setTimeout(() => logProgressDot(), 500)

    const results = await Promise.allSettled(
        allRepos.map(async (it) => {
            try {
                return [it.name, await gitter.cloneOrPull(it.name, it.defaultBranchRef.name, true, false)] as const
            } catch (e) {
                throw [it.name, e]
            }
        }),
    )
    process.stdout.write(' :D\n')

    const niceNice: [repo: string, status: 'updated' | 'cloned'][] = results
        .filter((it) => it.status === 'fulfilled' && typeof it.value[1] !== 'object')
        .map((it) => (it as any).value)
    const niceErrors: [repo: string, status: { type: 'error'; message: string }][] = results
        .filter((it) => it.status === 'fulfilled' && typeof it.value[1] === 'object')
        .map((it) => (it as any).value)
    const rejects: [repo: string, error: Error][] = results
        .filter((it) => it.status === 'rejected')
        .map((it) => (it as any).reason)

    const updated = niceNice.filter((it) => it[1] === 'updated').map((it) => it[0])
    const cloned = niceNice.filter((it) => it[1] === 'cloned').map((it) => it[0])

    log(`${chalk.green('Complete!')} The following happened:`)
    if (cloned.length > 0) {
        log(` - ${chalk.green(cloned.length)} repos were ${chalk.green('cloned')} fresh`)
    }
    if (updated.length > 0) {
        log(` - ${chalk.green(updated.length)} repos were ${chalk.green('updated')} without fuzz`)
    }
    if (niceErrors.length > 0) {
        log(` - ${chalk.yellow(niceErrors.length)} repos had errors:`)
        log(
            niceErrors
                .map(([repo, status]) => `   - ${chalk.yellow(repo)}: ${chalk.red(status.message.trim())}`)
                .join('\n'),
        )
    }
    if (rejects.length > 0) {
        log(` - ${chalk.red(rejects.length)} repos were not happy at all:`)
        log(rejects.map(([repo, error]) => `   - ${chalk.yellow(repo)}: ${chalk.red(error.message.trim())}`).join('\n'))
    }
}
