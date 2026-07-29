import { $ } from 'bun'
import chalk from 'chalk'
import { parseISO } from 'date-fns'
import * as R from 'remeda'

import { getTeam } from '../../common/config.ts'
import { coloredTimestamp } from '../../common/date-utils.ts'
import { log, logNoNewLine } from '../../common/log.ts'
import { BaseRepoNodeFragment, ghGqlQuery, OrgTeamRepoResult, removeIgnoredAndArchived } from '../../common/octokit.ts'

type CheckSuite = {
    status: string
    conclusion: string
    workflowRun: {
        databaseId: string
        event: string
        runNumber: number
        updatedAt: string
    } | null
    branch: {
        name: string
    }
}

export type BuildsBranchRefNode = {
    defaultBranchRef: {
        target: {
            message: string
            checkSuites: {
                nodes: CheckSuite[]
            }
        }
    }
}

export const buildsQuery = /* GraphQL */ `
    query OurRepos($team: String!) {
        organization(login: "navikt") {
            team(slug: $team) {
                repositories(orderBy: { field: PUSHED_AT, direction: DESC }) {
                    nodes {
                        ...BaseRepoNode
                        defaultBranchRef {
                            target {
                                ... on Commit {
                                    message
                                    checkSuites(last: 10) {
                                        nodes {
                                            status
                                            conclusion
                                            workflowRun {
                                                databaseId
                                                event
                                                runNumber
                                                updatedAt
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

export async function checkBuilds(rerunFailed: boolean): Promise<void> {
    const team = await getTeam()
    log(chalk.green(`Checking build status for all ${team} repos... ${rerunFailed ? '(will rerun failed)' : ''} \t`))

    const queryResult = await ghGqlQuery<OrgTeamRepoResult<BuildsBranchRefNode>>(buildsQuery, {
        team,
    })

    const reposByState = R.pipe(
        queryResult.organization.team.repositories.nodes,
        removeIgnoredAndArchived,
        R.map((repo) => ({
            name: repo.name,
            lastPush: parseISO(repo.pushedAt),
            commit: repo.defaultBranchRef.target.message,
            action: R.pipe(
                repo.defaultBranchRef.target.checkSuites.nodes,
                R.sortBy([(it) => it.workflowRun?.updatedAt ?? '', 'desc']),
                R.find((it) => it.workflowRun?.event === 'push'),
            ),
        })),
        R.filter((it) => it.action?.workflowRun != null),
        R.groupBy((it) => {
            if (it.action?.status === 'IN_PROGRESS') return 'BUILDING'

            if (!it.action?.conclusion) log(`Unknown status ${it.action?.status} for ${it.name}`)

            return it.action?.conclusion ?? 'unknown'
        }),
    )

    const { SUCCESS, FAILURE, CANCELLED, BUILDING, ...rest } = reposByState

    log(`Found ${R.pipe(reposByState, R.entries(), R.flatMap(R.last()), R.length())} repos with build status`)
    log(chalk.green(`  Success: ${SUCCESS?.length ?? 0} repos`))
    log(chalk.yellow(`  Bulding: ${BUILDING?.length ?? 0} repos`))
    for (const repo of BUILDING ?? []) {
        if (repo.action?.workflowRun?.updatedAt == null) {
            log(chalk.yellow(`   ${repo.name} doesn't have a timestamp`))
            continue
        }
        log(
            chalk.yellow(
                `   ${repo.name} started building ${coloredTimestamp(parseISO(repo.action.workflowRun.updatedAt))} ago`,
            ),
        )
    }
    log(chalk.red(`  Failure: ${FAILURE?.length ?? 0}`))
    for (const repo of FAILURE ?? []) {
        log(
            chalk.red(
                `   ${repo.name} failed ${
                    repo.action?.workflowRun?.updatedAt != null
                        ? coloredTimestamp(parseISO(repo.action.workflowRun.updatedAt))
                        : 'dunno lol'
                } ago`,
            ) +
                `\n\tActions: https://github.com/navikt/${repo.name}/actions?query=branch%3A${
                    repo.action?.branch.name ?? 'main'
                }`,
        )

        if (rerunFailed) {
            logNoNewLine(chalk.yellow(`        Rerunning failed build... →`))
            if (repo.action?.workflowRun?.databaseId == null) {
                log(chalk.red(`        ${repo.name} doesn't have an action id`))
            } else {
                try {
                    await $`gh run rerun -R navikt/${repo.name} ${repo.action.workflowRun.databaseId}`
                        .quiet()
                        .throws(true)
                    log(chalk.green(` OK!`))
                } catch (e) {
                    log(chalk.red(` Unable to rerun :( cause ${e as Error}`))
                }
            }
        }
    }

    if ((CANCELLED?.length ?? 0) > 0) {
        log(chalk.blue(`  Cancelled: ${CANCELLED.length}`))
        for (const repo of CANCELLED) {
            log(
                chalk.blue(`   ${repo.name}`) +
                    `: https://github.com/navikt/${repo.name}/actions?query=branch%3A${repo.action?.branch.name ?? 'main'}`,
            )
        }
    }

    if (Object.keys(rest).length > 0) {
        const categoryPairs = Object.entries(rest)
        const categories = categoryPairs.map(([key, value]) => `${key}: ${value.length}`)
        log(chalk.yellow(`  Others states: ${categories.join(', ')}`))
        for (const [key, value] of categoryPairs) {
            for (const repo of value) {
                log(
                    `    ${key}: ` +
                        chalk.yellow(`${repo.name}`) +
                        `: https://github.com/navikt/${repo.name}/actions?query=branch%3A${
                            repo.action?.branch.name ?? 'main'
                        }`,
                )
            }
        }
    }
}
