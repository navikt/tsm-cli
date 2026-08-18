import * as clack from '@clack/prompts'
import chalk from 'chalk'
import { parseISO } from 'date-fns'
import * as R from 'remeda'

import { withReposCache } from '../../common/cache/repos-cache.ts'
import { getTeam } from '../../common/config.ts'
import { coloredTimestamp } from '../../common/date-utils.ts'
import {
    BaseRepoNode,
    BaseRepoNodeFragment,
    ghGqlQuery,
    OrgTeamRepoResult,
    removeIgnoredAndArchived,
} from '../../common/octokit.ts'
import { tuiSession, withSpinner } from '../../common/tui.ts'

type ExtraPropsOnRepo = {
    primaryLanguage: {
        color: string
        name: string
    } | null
}

const reposQuery = /* GraphQL */ `
    query ($team: String!) {
        organization(login: "navikt") {
            team(slug: $team) {
                repositories(orderBy: { field: PUSHED_AT, direction: DESC }) {
                    nodes {
                        ...BaseRepoNode
                        primaryLanguage {
                            color
                            name
                        }
                    }
                }
            }
        }
    }

    ${BaseRepoNodeFragment}
`

export async function getRepos(): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm repos ')), async () => {
        const team = await getTeam()

        const nodes = await withSpinner(
            `Fetching repos for ${chalk.yellow(team)}`,
            () =>
                withReposCache<BaseRepoNode<ExtraPropsOnRepo>>(
                    `with-lang-${team}`,
                    `all repositories for team ${team}`,
                    async () => {
                        const queryResult = await ghGqlQuery<OrgTeamRepoResult<ExtraPropsOnRepo>>(reposQuery, {
                            team,
                        })

                        return queryResult.organization.team.repositories.nodes
                    },
                ),
            (nodes) => `Found ${chalk.yellow(removeIgnoredAndArchived(nodes).length)} repos in ${chalk.yellow(team)}`,
        )

        const reposByLang = R.pipe(
            nodes,
            removeIgnoredAndArchived,
            R.groupBy((it) => it.primaryLanguage?.name ?? 'unknown'),
            R.mapValues(R.sortBy([(it) => it.pushedAt, 'asc'])),
            R.entries(),
            R.sortBy(([, [firstNode]]) => firstNode.pushedAt),
        )

        if (reposByLang.length === 0) {
            clack.log.warn(`No repos found for ${team}`)
            return
        }

        clack.note(reposByLang.map(toLanguageSection).join('\n\n'), `Repos in ${team}`)
    })
}

function toLanguageSection([lang, repos]: [string, BaseRepoNode<ExtraPropsOnRepo>[]]): string {
    const header = chalk.hex(repos[0].primaryLanguage?.color ?? '#FFFFFF')(`${lang} (${repos.length})`)
    const lines = repos.map((it) => `  ${it.name} ${coloredTimestamp(parseISO(it.pushedAt))} ago ${chalk.gray(it.url)}`)

    return [header, ...lines].join('\n')
}
