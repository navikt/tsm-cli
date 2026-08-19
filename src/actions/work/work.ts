import * as clack from '@clack/prompts'
import chalk from 'chalk'
import { add, endOfDay, formatISO, startOfDay } from 'date-fns'
import * as R from 'remeda'

import { getTeam } from '../../common/config.ts'
import { humanDay } from '../../common/date-utils.ts'
import { authorToColorAvatar } from '../../common/format-utils.ts'
import { BaseRepoNodeFragment, ghGqlQuery, OrgTeamRepoResult, removeIgnoredAndArchived } from '../../common/octokit.ts'
import { tuiSession, withSpinner } from '../../common/tui.ts'

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

type ClassifiedCommit = {
    repo: string
    commit: CommitsInRangeNode['defaultBranchRef']['target']['history']['nodes'][number]
    type: string
}

export async function displayCommitsForPeriod(
    fom: Date,
    days: number,
    includeUncategorizeable: boolean,
    author: string | null,
): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm work ')), async () => {
        const team = await getTeam()
        const fomDate = formatISO(startOfDay(fom))
        const tomDate = formatISO(endOfDay(add(fom, { days })))

        const result = await withSpinner(
            `Getting commits for ${chalk.yellow(team)} from ${humanDay(fomDate)} to ${humanDay(tomDate)}${
                author != null ? ` by ${chalk.yellow(author)}` : ''
            }`,
            () => getCommitsByType(team, fomDate, tomDate, author),
            (result) => `Found ${chalk.yellow(R.values(result).flat().length)} commits`,
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

        for (const [category, commits] of R.entries(orderedCategories)) {
            clack.log.message(`${chalk.bold.bgBlueBright.white(` ${category} `)}\n${toCategoryBody(commits ?? [])}`)
        }

        if (includeUncategorizeable && unknown?.length) {
            clack.log.message(`${chalk.bold.bgBlueBright.white(' unknown ')}\n${unknown.map(toUnknownLine).join('\n')}`)
        }

        const alsoLines = [
            automated ? `${chalk.yellow(automated.length)} automated commits` : null,
            dependabotMerges ? `${chalk.yellow(dependabotMerges.length)} dependabot merges` : null,
            unknown && !includeUncategorizeable
                ? `${chalk.yellow(unknown.length)} commits of unknown type (use ${chalk.yellow('--unknown')} to see them)`
                : null,
        ].filter((it) => it != null)

        if (alsoLines.length > 0) {
            clack.log.info(`There were also:\n${alsoLines.map((it) => `  ${it}`).join('\n')}`)
        }
    })
}

async function getCommitsByType(
    team: string,
    fomDate: string,
    tomDate: string,
    author: string | null,
): Promise<Partial<Record<string, ClassifiedCommit[]>>> {
    const queryResult = await ghGqlQuery<OrgTeamRepoResult<CommitsInRangeNode>>(commitsInRangeQuery, {
        team,
        fom: fomDate,
        tom: tomDate,
    })

    return R.pipe(
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
}

/**
 * Collapses commits that share the same subject across repos into a single line.
 */
function toCategoryBody(commits: ClassifiedCommit[]): string {
    if (commits.length === 0) {
        return chalk.gray('  0 changes')
    }

    const deduplicated = R.groupBy(commits, (it) => {
        const parsed = parseConventionalSubject(it.commit.message)

        return `${parsed?.scope ?? ''}|${cleanSubject(it.commit.message)}`
    })

    return R.values(deduplicated)
        .map((messages) => {
            const parsed = parseConventionalSubject(messages[0].commit.message)
            const cleanMessage = cleanSubject(messages[0].commit.message)
            const scope = parsed?.scope != null ? `${chalk.yellow(parsed.scope)}: ` : ''

            if (messages.length === 1) {
                return `  ${scope}${cleanMessage} in ${chalk.green(messages[0].repo)}`
            } else if (messages.length <= 3) {
                return `  ${scope}${cleanMessage} in ${messages.map((it) => chalk.green(it.repo)).join(', ')}`
            } else {
                return `  ${scope}${cleanMessage} in ${chalk.blueBright(`${messages.length} repos`)}`
            }
        })
        .join('\n')
}

function cleanSubject(message: string): string {
    const parsed = parseConventionalSubject(message)

    return (parsed?.rest ?? message.split('\n')[0])
        .replace(/\[skip\s*-?ci]/, '')
        .replace(/\s*\(#[0-9]+\)/, '')
        .trim()
}

function toUnknownLine(commit: ClassifiedCommit): string {
    const cleanMessage = commit.commit.message.split('\n')[0].trim()
    const author = commit.commit.author.user?.login ?? commit.commit.author.name

    return `  ${cleanMessage} in ${chalk.green(commit.repo)} (by ${author} ${authorToColorAvatar(author)})`
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
            return parseConventionalSubject(commit.message)?.type ?? 'unknown'
    }
}

/**
 * Matches conventional commit subjects, with optional scope and breaking change marker:
 * `feat: msg`, `feat(scope): msg`, `feat(scope)!: msg`
 */
const conventionalCommitRegex = /^(\w+)(?:\(([^()]+)\))?!?:\s*/

function parseConventionalSubject(message: string): { type: string; scope: string | null; rest: string } | null {
    const subject = message.split('\n')[0]
    const match = subject.match(conventionalCommitRegex)

    if (match == null) return null

    return {
        type: match[1],
        scope: match[2] ?? null,
        rest: subject.slice(match[0].length),
    }
}
