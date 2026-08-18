import chalk from 'chalk'
import { parseISO } from 'date-fns'
import * as R from 'remeda'

import { withReposCache } from '../../common/cache/repos-cache.ts'
import { getTeam } from '../../common/config.ts'
import { coloredTimestamp } from '../../common/date-utils.ts'
import { log } from '../../common/log.ts'
import {
    BaseRepoNode,
    BaseRepoNodeFragment,
    ghGqlQuery,
    OrgTeamRepoResult,
    removeIgnoredAndArchived,
} from '../../common/octokit.ts'

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
    const team = await getTeam()

    const nodes = await withReposCache<BaseRepoNode<ExtraPropsOnRepo>>(
        `with-lang-${team}`,
        `all repositories for team ${team}`,
        async () => {
            const queryResult = await ghGqlQuery<OrgTeamRepoResult<ExtraPropsOnRepo>>(reposQuery, {
                team,
            })

            return queryResult.organization.team.repositories.nodes
        },
    )

    log(`\nFound ${chalk.green(removeIgnoredAndArchived(nodes).length)} repos:\n`)

    const reposByLang = R.pipe(
        nodes,
        removeIgnoredAndArchived,
        R.groupBy((it) => it.primaryLanguage?.name ?? 'unknown'),
        R.mapValues(R.sortBy([(it) => it.pushedAt, 'asc'])),
        R.entries(),
        R.sortBy(([, [firstNode]]) => firstNode.pushedAt),
    )

    reposByLang.forEach(([lang, repos]) => {
        log(chalk.hex(repos[0].primaryLanguage?.color ?? '#FFFFF')(`${lang}:`))
        log(
            R.pipe(
                repos,
                R.map((it) => ` - ${it.name} ${coloredTimestamp(parseISO(it.pushedAt))} ago - ${it.url}`),
                R.join('\n'),
            ),
        )
    })
}
