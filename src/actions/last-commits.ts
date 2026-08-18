import * as clack from '@clack/prompts'
import chalk from 'chalk'
import { parseISO } from 'date-fns'
import * as R from 'remeda'

import { getTeam } from '../common/config.ts'
import { coloredTimestamp } from '../common/date-utils.ts'
import { authorToColorAvatar } from '../common/format-utils.ts'
import { BaseRepoNodeFragment, ghGqlQuery, OrgTeamRepoResult, removeIgnoredAndArchived } from '../common/octokit.ts'
import { tuiSession, withSpinner } from '../common/tui.ts'

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

type RepoCommit = {
    name: string
    lastPush: Date
    commit: string
    author: { avatarUrl: string; user: { login: string } }
    action: CheckSuite | undefined
}

async function getLastCommitsByRepo(
    team: string,
    order: 'asc' | 'desc',
    limit: number | undefined,
): Promise<RepoCommit[]> {
    return await withSpinner(
        `Getting ${limit == null ? 'all' : limit} repos in order ${order} for ${chalk.yellow(team)}`,
        async () => {
            const queryResult = await ghGqlQuery<OrgTeamRepoResult<BranchRefNode>>(reposQuery, {
                team,
                order: order.toUpperCase(),
                limit: limit,
            })

            return R.pipe(
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
        },
        (repos) => `Got ${chalk.yellow(repos.length)} repos for ${chalk.yellow(team)}`,
    )
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
    await tuiSession(chalk.bgCyan(chalk.black(' tsm commits ')), async () => {
        const commits = await getLastCommitsByRepo(await getTeam(), order, limit)

        if (commits.length === 0) {
            clack.log.warn('No repos found')
            return
        }

        clack.log.message(commits.map(toCommitLine).join('\n'))
    })
}

function toCommitLine(it: RepoCommit): string {
    const subject = it.commit.split('\n')[0]
    const event = it.action?.workflowRun?.event ?? 'none'

    return (
        `${authorToColorAvatar(it.author.user.login)} ` +
        `${`${coloredStatus(it.action)}: `.padEnd(21, ' ')}` +
        `${coloredTimestamp(it.lastPush)} ${chalk.blue(it.name)}: ${subject} ` +
        chalk.gray(`(${event}) - ${it.author.user.login}`)
    )
}
