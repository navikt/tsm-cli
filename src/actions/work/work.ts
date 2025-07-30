import * as R from 'remeda'
import { add, endOfDay, formatISO, startOfDay } from 'date-fns'
import chalk from 'chalk'

import { BaseRepoNodeFragment, ghGqlQuery, OrgTeamRepoResult, removeIgnoredAndArchived } from '../../common/octokit.ts'
import { log } from '../../common/log.ts'
import { humanDay } from '../../common/date-utils.ts'
import { authorToColorAvatar } from '../../common/format-utils.ts'
import { getTeam } from '../../common/config.ts'

type CommitsInRangeNode = {
    defaultBranchRef: {
        target: {
            history: {
                nodes: {
                    message: string
                    author: {
                        date: string
                        email: string
                        name: string
                        user: {
                            name: string
                            login: string
                        } | null
                    }
                }[]
            }
        }
    }
}

const commitsInRangeQuery = /* GraphQL */ `
    query OurRepos($team: String!, $fom: GitTimestamp!, $tom: GitTimestamp!) {
        organization(login: "navikt") {
            team(slug: $team) {
                repositories(orderBy: { field: PUSHED_AT, direction: DESC }, first: 100) {
                    nodes {
                        ...BaseRepoNode
                        defaultBranchRef {
                            target {
                                ... on Commit {
                                    history(since: $fom, until: $tom, first: 100) {
                                        nodes {
                                            message
                                            author {
                                                date
                                                email
                                                name
                                                user {
                                                    name
                                                    login
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
    }

    ${BaseRepoNodeFragment}
`

export async function displayCommitsForPeriod(
    fom: Date,
    days: number,
    includeUncategorizeable: boolean,
    author: string | null,
): Promise<void> {
    const team = await getTeam()
    const fomDate = formatISO(startOfDay(fom))
    const tomDate = formatISO(endOfDay(add(fom, { days })))

    log(
        chalk.green(
            `Getting commits for team ${team} from ${humanDay(fomDate)} to ${humanDay(tomDate)}${
                author != null ? ` for author ${author}` : ''
            }\n`,
        ),
    )

    const queryResult = await ghGqlQuery<OrgTeamRepoResult<CommitsInRangeNode>>(commitsInRangeQuery, {
        team,
        fom: fomDate,
        tom: tomDate,
    })

    const result = R.pipe(
        queryResult.organization.team.repositories.nodes,
        removeIgnoredAndArchived,
        R.map((repo) => ({
            name: repo.name,
            commits: repo.defaultBranchRef.target.history.nodes.filter((it) => it.author.name !== 'dependabot[bot]'),
        })),
        R.filter((it) => it.commits.length > 0),
        R.flatMap((it) => it.commits.map((commit) => ({ repo: it.name, commit }))),
        R.map((commit) => ({
            ...commit,
            type: classifyCommit(commit.commit),
        })),
        (classifiedCommit) => {
            if (author == null) return classifiedCommit

            return R.filter(classifiedCommit, (commit) => commit.commit.author.user?.login === author)
        },
        R.sortBy([(it) => it.commit.author.date, 'desc']),
        R.groupBy((it) => it.type),
    )

    const {
        feat,
        fix,
        test,
        perf,
        refactor,
        chore,
        docs,
        automated,
        'dependabot-merge': dependabotMerges,
        unknown,
        ...rest
    } = result
    const orderedCategories: typeof result = {
        feat: feat ?? [],
        fix: fix ?? [],
        test: test ?? [],
        perf: perf ?? [],
        refactor: refactor ?? [],
        chore: chore ?? [],
        docs: docs ?? [],
        ...rest,
    }

    for (const category in orderedCategories) {
        log(chalk.bold.bgBlueBright.white(category))
        if (orderedCategories[category].length === 0) {
            log(`  0 changes`)
            continue
        }

        const deduplicatedMessagesInCategory = R.groupBy(orderedCategories[category], (it) =>
            it.commit.message
                .split('\n')[0]
                .replace(/\s*\(#[0-9]+\)/, '')
                .trim(),
        )

        for (const messages of R.values(deduplicatedMessagesInCategory)) {
            const commit = messages[0]
            const cleanMessage = commit.commit.message
                .split('\n')[0]
                .replace(/^(\w+):/, '')
                .replace(/\[skip\s*-?ci]/, '')
                .replace(/\s*\(#[0-9]+\)/, '')
                .trim()

            if (messages.length === 1) {
                log(`  ${cleanMessage} in ${chalk.green(commit.repo)}`)
            } else if (messages.length <= 3) {
                log(`  ${cleanMessage} in ${messages.map((it) => chalk.green(it.repo)).join(', ')}`)
            } else {
                log(`  ${cleanMessage} in ${chalk.blueBright(`${messages.length} repos`)}`)
            }
        }
    }

    if (includeUncategorizeable && unknown?.length) {
        log(chalk.bold.bgBlueBright.white('unknown'))
        for (const commit of unknown) {
            const cleanMessage = commit.commit.message.split('\n')[0].trim()

            log(
                `  ${cleanMessage} in ${chalk.green(commit.repo)} (by ${
                    commit.commit.author.user?.login ?? commit.commit.author.name
                } ${authorToColorAvatar(commit.commit.author.user?.login ?? commit.commit.author.name)})`,
            )
        }
    }

    if (automated || dependabotMerges || (unknown && !includeUncategorizeable)) log('\nThere were also:')
    if (automated) log(`  ${chalk.yellow(automated.length)} automated commits`)
    if (dependabotMerges) log(`  ${chalk.yellow(dependabotMerges.length)} dependabot merges`)
    if (unknown && !includeUncategorizeable) log(`  ${chalk.yellow(unknown.length)} commits of unknown type`)
}

function classifyCommit(commit: {
    message: string
    author: { date: string; email: string; name: string; user: { name: string; login: string } | null }
}): string {
    switch (true) {
        case /^Merge pull request.*dependabot/g.test(commit.message):
            return 'dependabot-merge'
        case commit.message.includes('[skip ci] bump version'):
            return 'automated'
        case commit.message.includes('chore(deps)'):
            return 'deps'
        default:
            return commit.message.match(/^(\w+):/)?.[1] ?? 'unknown'
    }
}
