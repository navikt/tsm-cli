import chalk from 'chalk'
import { parseISO } from 'date-fns'
import * as R from 'remeda'

import { getTeam } from '../common/config.ts'
import { coloredTimestamp } from '../common/date-utils.ts'
import { authorToColorAvatar } from '../common/format-utils.ts'
import { log } from '../common/log.ts'
import { BaseRepoNodeFragment, ghGqlQuery, OrgTeamRepoResult, removeIgnoredAndArchived } from '../common/octokit.ts'

type CheckSuite = {
    status: string
    conclusion: string
    workflowRun: {
        event: string
        runNumber: number
    } | null
    branch: {
        name: string
    }
}

type BranchRefNode = {
    defaultBranchRef: {
        target: {
            message: string
            author: {
                avatarUrl: string
                user: { login: string }
            }
            checkSuites: {
                nodes: CheckSuite[]
            }
        }
    }
}

const reposQuery = /* GraphQL */ `
    query OurRepos($team: String!, $order: OrderDirection!) {
        organization(login: "navikt") {
            team(slug: $team) {
                repositories(orderBy: { field: PUSHED_AT, direction: $order }) {
                    nodes {
                        ...BaseRepoNode
                        defaultBranchRef {
                            target {
                                ... on Commit {
                                    message
                                    author {
                                        avatarUrl
                                        user {
                                            login
                                        }
                                    }
                                    checkSuites(last: 1) {
                                        nodes {
                                            status
                                            conclusion
                                            workflowRun {
                                                event
                                                runNumber
                                            }
                                            branch {
                                                name
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    ${BaseRepoNodeFragment}
`

async function getLastCommitsByRepo(
    team: string,
    order: 'asc' | 'desc',
    limit: number | undefined,
): Promise<
    {
        name: string
        lastPush: Date
        commit: string
        author: { avatarUrl: string; user: { login: string } }
        action: CheckSuite | undefined
    }[]
> {
    log(chalk.green(`Getting ${limit == null ? 'all' : limit} repositories in order ${order} for team ${team}`))

    const queryResult = await ghGqlQuery<OrgTeamRepoResult<BranchRefNode>>(reposQuery, {
        team,
        order: order.toUpperCase(),
        limit: limit,
    })

    const repos = R.pipe(
        queryResult.organization.team.repositories.nodes,
        removeIgnoredAndArchived,
        R.map((repo) => ({
            name: repo.name,
            lastPush: parseISO(repo.pushedAt),
            commit: repo.defaultBranchRef.target.message,
            author: repo.defaultBranchRef.target.author,
            action: repo.defaultBranchRef.target.checkSuites.nodes[0],
        })),
        R.take(limit ?? Infinity),
    )

    log(`Got ${chalk.greenBright(repos.length)} repositories for team ${team}`)

    return repos
}

function coloredStatus(action: CheckSuite | undefined): string {
    if (action == null) {
        return chalk.gray('NO ACTIONS')
    }

    if (action.workflowRun == null) {
        // Was likely skipped
        return chalk.gray('SKIPPED')
    }
    switch (action.status) {
        case 'COMPLETED':
            return chalk.green(action.status)
        case 'IN_PROGRESS':
            return chalk.yellow(action.status)
        case 'QUEUED':
            return chalk.gray(action.status)
        default:
            return chalk.red(action.status)
    }
}

export async function lastCommits(order: 'asc' | 'desc', limit: number | undefined): Promise<void> {
    const lastCommits = await getLastCommitsByRepo(await getTeam(), order, limit)

    log(
        lastCommits
            .map(
                (it) =>
                    `${authorToColorAvatar(it.author.user.login)} ${`${coloredStatus(it.action)}: `.padEnd(21, ' ')}${coloredTimestamp(it.lastPush)} ${it.name}: ${
                        it.commit.split('\n')[0]
                    } (${it.action?.workflowRun?.event ?? 'none'}) - ${it.author.user.login}`,
            )
            .join('\n'),
    )
}
