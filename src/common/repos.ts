import chalk from 'chalk'

import { withReposCache } from './cache/repos-cache.ts'
import { getTeam } from './config.ts'
import { Gitter } from './git.ts'
import { log, logError } from './log.ts'
import {
    BaseRepoNode,
    BaseRepoNodeFragment,
    ghGqlQuery,
    OrgTeamRepoResult,
    removeIgnoredAndArchived,
} from './octokit.ts'
import { withSpinner } from './tui.ts'

const blacklist: string[] = ['vault-iac', 'omrade-helse-etterlevelse-topic']

export function blacklisted<Repo extends { name: string }>(repo: Repo): boolean {
    return !blacklist.includes(repo.name)
}

export async function getAllRepos(team: string, includeArchived: boolean = false): Promise<BaseRepoNode<unknown>[]> {
    const nodes = await withReposCache<BaseRepoNode<unknown>>(
        `all-${team}`,
        `all active repositories for team ${team}`,
        async () => {
            const result = await ghGqlQuery<OrgTeamRepoResult<unknown>>(
                /* GraphQL */ `
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
                `,
                { team },
            )

            return result.organization.team.repositories.nodes
        },
    )

    if (includeArchived) return nodes
    return removeIgnoredAndArchived(nodes).filter(blacklisted)
}

/**
 * Fetches all repos for the current team and makes sure the local git cache is up to date.
 */
export async function updateRepoCache(gitter: Gitter): Promise<BaseRepoNode<unknown>[]> {
    const team = await getTeam()

    const repos = await withSpinner(
        `Fetching repos for ${team}`,
        () => getAllRepos(team),
        (repos) => `Found ${chalk.yellow(repos.length)} repos in ${chalk.yellow(team)}`,
    )

    await withSpinner(
        'Updating local git cache',
        async (spinner) => {
            let done = 0

            await Promise.all(
                repos.map(async (repo) => {
                    await gitter.cloneOrPull(repo.name, repo.defaultBranchRef.name, true)
                    spinner.message(`Updating local git cache (${++done}/${repos.length})`)
                }),
            )
        },
        () => `Updated ${chalk.yellow(repos.length)} repos`,
    )

    return repos
}

export async function getRepo(repoFullName: string): Promise<BaseRepoNode<unknown>[]> {
    const [owner, name] = repoFullName.split('/')
    if (!owner || !name) {
        log(chalk.red(`Invalid repo format: ${repoFullName}. Expected owner/name.`))
        return []
    }

    const singleRepoQuery = /* GraphQL */ `
        query SingleRepo($owner: String!, $name: String!) {
            repository(owner: $owner, name: $name) {
                ...BaseRepoNode
            }
        }

        ${BaseRepoNodeFragment}
    `
    log(chalk.green(`Getting single repository ${owner}/${name}...`))
    try {
        const result = await ghGqlQuery<{ repository: BaseRepoNode<unknown> | null }>(singleRepoQuery, { owner, name })

        if (result.repository) {
            return [result.repository]
        } else {
            return []
        }
    } catch (e) {
        logError(chalk.red(`\nError fetching single repo ${owner}/${name}:`), e)
        return []
    }
}
