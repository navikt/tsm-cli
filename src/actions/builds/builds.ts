import * as clack from '@clack/prompts'
import { $ } from 'bun'
import chalk from 'chalk'
import { parseISO } from 'date-fns'
import * as R from 'remeda'

import { getTeam } from '../../common/config.ts'
import { coloredTimestamp } from '../../common/date-utils.ts'
import { BaseRepoNodeFragment, ghGqlQuery, OrgTeamRepoResult, removeIgnoredAndArchived } from '../../common/octokit.ts'
import { tuiSession, withSpinner } from '../../common/tui.ts'

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

type BuildRepo = {
    name: string
    lastPush: Date
    commit: string
    action: CheckSuite | undefined
}

export async function checkBuilds(rerunFailed: boolean): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm builds ')), async () => {
        const reposByState = await fetchBuildStates()

        const { SUCCESS, FAILURE, CANCELLED, BUILDING, ...rest } = reposByState
        const total = R.pipe(reposByState, R.entries(), R.flatMap(R.last()), R.length())

        clack.note(
            [
                `${chalk.green('✓')} Success:   ${SUCCESS?.length ?? 0}`,
                `${chalk.yellow('●')} Building:  ${BUILDING?.length ?? 0}`,
                `${chalk.red('✗')} Failure:   ${FAILURE?.length ?? 0}`,
                `${chalk.blue('○')} Cancelled: ${CANCELLED?.length ?? 0}`,
            ].join('\n'),
            `${total} repos with build status`,
        )

        if (BUILDING?.length) {
            clack.log.warn(BUILDING.map(toBuildingLine).join('\n'))
        }

        if (FAILURE?.length) {
            clack.log.error(FAILURE.map(toFailureLine).join('\n'))
        }

        if (CANCELLED?.length) {
            clack.log.info(CANCELLED.map((it) => `${chalk.blue(it.name)}: ${actionsUrl(it)}`).join('\n'))
        }

        for (const [state, repos] of Object.entries(rest)) {
            clack.log.warn(
                (repos ?? []).map((it) => `${state}: ${chalk.yellow(it.name)}: ${actionsUrl(it)}`).join('\n'),
            )
        }

        if (rerunFailed) {
            await rerunFailedBuilds(FAILURE ?? [])
        }
    })
}

async function fetchBuildStates(): Promise<Partial<Record<string, BuildRepo[]>>> {
    const team = await getTeam()
    const unknownStates: string[] = []

    const reposByState = await withSpinner(
        `Checking build status for all ${chalk.yellow(team)} repos`,
        async () => {
            const queryResult = await ghGqlQuery<OrgTeamRepoResult<BuildsBranchRefNode>>(buildsQuery, { team })

            return R.pipe(
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

                    if (!it.action?.conclusion) {
                        unknownStates.push(`Unknown status ${it.action?.status} for ${it.name}`)
                    }

                    return it.action?.conclusion ?? 'unknown'
                }),
            )
        },
        () => `Fetched build status for ${chalk.yellow(team)}`,
    )

    if (unknownStates.length > 0) {
        clack.log.warn(unknownStates.join('\n'))
    }

    return reposByState
}

async function rerunFailedBuilds(failed: BuildRepo[]): Promise<void> {
    if (failed.length === 0) {
        clack.log.success('No failed builds to rerun')
        return
    }

    const confirmed = await clack.confirm({
        message: `Rerun ${failed.length} failed build(s)?`,
    })

    if (clack.isCancel(confirmed) || !confirmed) {
        clack.log.warn('Aborting, no builds were rerun')
        return
    }

    await withSpinner(
        'Rerunning failed builds',
        async (spinner) => {
            const errors: string[] = []
            let done = 0

            for (const repo of failed) {
                if (repo.action?.workflowRun?.databaseId == null) {
                    errors.push(`${repo.name} doesn't have an action id`)
                } else {
                    try {
                        await $`gh run rerun -R navikt/${repo.name} ${repo.action.workflowRun.databaseId}`
                            .quiet()
                            .throws(true)
                    } catch (e) {
                        errors.push(`${repo.name}: unable to rerun, cause ${e as Error}`)
                    }
                }

                spinner.message(`Rerunning failed builds (${++done}/${failed.length})`)
            }

            return errors
        },
        (errors) =>
            errors.length === 0
                ? `Reran ${chalk.green(failed.length)} builds`
                : `Reran ${chalk.green(failed.length - errors.length)} builds, ${chalk.red(errors.length)} failed:\n${chalk.gray(errors.join('\n'))}`,
    )
}

function toBuildingLine(repo: BuildRepo): string {
    const updatedAt = repo.action?.workflowRun?.updatedAt

    return updatedAt == null
        ? `${repo.name} doesn't have a timestamp`
        : `${repo.name} started building ${coloredTimestamp(parseISO(updatedAt))} ago`
}

function toFailureLine(repo: BuildRepo): string {
    const updatedAt = repo.action?.workflowRun?.updatedAt
    const when = updatedAt != null ? `${coloredTimestamp(parseISO(updatedAt))} ago` : 'at an unknown time'

    return `${repo.name} failed ${when}\n${chalk.gray(actionsUrl(repo))}`
}

function actionsUrl(repo: BuildRepo): string {
    return `https://github.com/navikt/${repo.name}/actions?query=branch%3A${repo.action?.branch.name ?? 'main'}`
}
