import chalk from 'chalk'
import { parseISO } from 'date-fns'
import * as R from 'remeda'

import { getTeam } from '../common/config.ts'
import { coloredTimestamp } from '../common/date-utils.ts'
import { authorToColorAvatar } from '../common/format-utils.ts'
import { log } from '../common/log.ts'
import { BaseRepoNodeFragment, ghGqlQuery, OrgTeamRepoResult, removeIgnoredAndArchived } from '../common/octokit.ts'

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
    log(
        chalk.green(
            `Getting all open prs for team ${team}${opts.includeDrafts ? ' (including drafts)' : ''}${
                opts.noBot ? ' (without bots)' : ''
            }`,
        ),
    )

    const queryResult = await ghGqlQuery<OrgTeamRepoResult<PullRequestNode>>(reposQuery, { team })

    const openPrs = R.pipe(
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

    log(`Found ${chalk.greenBright(Object.values(openPrs).flat().length)} open prs for team ${team}\n`)

    return openPrs
}

export async function openPrs(includeDrafts: boolean, noBot: boolean): Promise<void> {
    const openPrs = await getPrs(await getTeam(), { includeDrafts, noBot })

    R.pipe(
        openPrs,
        R.entries(),
        R.sortBy([([, prs]) => R.first(prs)?.updatedAt ?? '', 'desc']),
        R.forEach(([repo, prs]) => {
            log(chalk.greenBright(repo))
            prs.forEach((pr) => {
                log(
                    `\t${pr.title} (${pr.permalink})\n\tBy ${authorToColorAvatar(pr.author.login)} ${
                        pr.author.login
                    } ${coloredTimestamp(parseISO(pr.updatedAt))} ago${pr.isDraft ? ' (draft)' : ''}`,
                )
            })
        }),
    )
}
