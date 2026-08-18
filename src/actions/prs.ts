import * as clack from '@clack/prompts'
import chalk from 'chalk'
import { parseISO } from 'date-fns'
import * as R from 'remeda'

import { getTeam } from '../common/config.ts'
import { coloredTimestamp } from '../common/date-utils.ts'
import { authorToColorAvatar } from '../common/format-utils.ts'
import { BaseRepoNodeFragment, ghGqlQuery, OrgTeamRepoResult, removeIgnoredAndArchived } from '../common/octokit.ts'
import { tuiSession, withSpinner } from '../common/tui.ts'

type PrNode = {
    title: string
    updatedAt: string
    permalink: string
    isDraft: boolean
    author: {
        avatarUrl: string
        login: string
    }
}

type PullRequestNode = {
    pullRequests: {
        nodes: PrNode[]
    }
}

const reposQuery = /* GraphQL */ `
    query OurRepos($team: String!) {
        organization(login: "navikt") {
            team(slug: $team) {
                repositories(orderBy: { field: PUSHED_AT, direction: DESC }) {
                    nodes {
                        ...BaseRepoNode
                        pullRequests(first: 10, orderBy: { field: UPDATED_AT, direction: DESC }, states: OPEN) {
                            nodes {
                                title
                                updatedAt
                                permalink
                                isDraft
                                author {
                                    avatarUrl
                                    login
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

async function getPrs(
    team: string,
    opts: { includeDrafts: boolean; noBot: boolean },
): Promise<Record<string, PrNode[]>> {
    const filters = [opts.includeDrafts ? 'including drafts' : null, opts.noBot ? 'without bots' : null].filter(
        (it) => it != null,
    )

    return await withSpinner(
        `Getting all open PRs for ${chalk.yellow(team)}${filters.length > 0 ? ` (${filters.join(', ')})` : ''}`,
        async () => {
            const queryResult = await ghGqlQuery<OrgTeamRepoResult<PullRequestNode>>(reposQuery, { team })

            return R.pipe(
                queryResult.organization.team.repositories.nodes,
                removeIgnoredAndArchived,
                R.flatMap((repo) =>
                    R.pipe(
                        repo.pullRequests.nodes,
                        R.map((pr): [string, PrNode] => [repo.name, pr]),
                        R.sortBy(([, pr]) => pr.updatedAt),
                        R.filter(([, pr]) => opts.includeDrafts || !pr.isDraft),
                        R.filter(([, pr]) => !opts.noBot || !pr.author.login.includes('dependabot')),
                    ),
                ),
                R.groupBy(([repo]) => repo),
                R.mapValues((value) => value.map((it) => it[1])),
            )
        },
        (openPrs) =>
            `Found ${chalk.yellow(Object.values(openPrs).flat().length)} open PRs in ${chalk.yellow(
                Object.keys(openPrs).length,
            )} repos`,
    )
}

export async function openPrs(includeDrafts: boolean, noBot: boolean): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm prs ')), async () => {
        const prsByRepo = await getPrs(await getTeam(), { includeDrafts, noBot })

        const repos = R.pipe(prsByRepo, R.entries(), R.sortBy([([, prs]) => R.first(prs)?.updatedAt ?? '', 'desc']))

        if (repos.length === 0) {
            clack.log.success('No open PRs')
            return
        }

        clack.note(
            repos.map(([repo, prs]) => `${chalk.green(repo)}\n${prs.map(toPrLine).join('\n')}`).join('\n\n'),
            `${Object.values(prsByRepo).flat().length} open PRs`,
        )
    })
}

function toPrLine(pr: PrNode): string {
    const draft = pr.isDraft ? chalk.gray(' (draft)') : ''

    return (
        `  ${pr.title}${draft}\n` +
        `  ${authorToColorAvatar(pr.author.login)} ${pr.author.login} ${coloredTimestamp(parseISO(pr.updatedAt))} ago ` +
        chalk.gray(pr.permalink)
    )
}
