import chalk from 'chalk'
import * as R from 'remeda'

import { getTeam } from '../common/config.ts'
import { authorToColorAvatar } from '../common/format-utils.ts'
import { log } from '../common/log.ts'
import { ghGqlQuery, OrgTeamResult } from '../common/octokit.ts'

type MemberNodes = {
    members: {
        nodes: {
            login: string
            name: string
            avatarUrl: string
        }[]
    }
}

const reposQuery = /* GraphQL */ `
    query TeamMembers($team: String!) {
        organization(login: "navikt") {
            team(slug: $team) {
                members {
                    nodes {
                        login
                        name
                        avatarUrl
                    }
                }
            }
        }
    }
`

export async function displayMembers(name: string | null): Promise<void> {
    const team = name ?? (await getTeam())

    log(chalk.green(`Getting team members for team ${team}`))

    const queryResult = await ghGqlQuery<OrgTeamResult<MemberNodes>>(reposQuery, { team })

    if (queryResult.organization.team == null) {
        log(`${chalk.red(`\nCould not find team "${team}"`)}\n\nAre you sure you provided the correct team name?`)
        process.exit(1)
    }

    const members = queryResult.organization.team.members.nodes

    log(`Found ${chalk.greenBright(members.length)} members in team ${team}!`)

    R.pipe(
        members,
        R.forEach((it) => {
            log(
                `  ${authorToColorAvatar(it.login)} ${
                    it.name ? `${it.name} (${chalk.greenBright(it.login)})` : chalk.greenBright(it.login)
                } - ${chalk.blueBright(`https://github.com/${it.login}`)}`,
            )
        }),
    )
}
