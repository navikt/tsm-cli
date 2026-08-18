import * as clack from '@clack/prompts'
import chalk from 'chalk'

import { getTeam } from '../common/config.ts'
import { authorToColorAvatar } from '../common/format-utils.ts'
import { ghGqlQuery, OrgTeamResult } from '../common/octokit.ts'
import { tuiSession, withSpinner } from '../common/tui.ts'

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

type Member = MemberNodes['members']['nodes'][number]

export async function displayMembers(name: string | null): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm team ')), async () => {
        const team = name ?? (await getTeam())

        const members = await withSpinner(
            `Getting team members for ${chalk.yellow(team)}`,
            async () => {
                const queryResult = await ghGqlQuery<OrgTeamResult<MemberNodes>>(reposQuery, { team })

                return queryResult.organization.team?.members.nodes ?? null
            },
            (members) =>
                members == null
                    ? `Could not find team ${chalk.red(team)}`
                    : `Found ${chalk.yellow(members.length)} members in ${chalk.yellow(team)}`,
        )

        if (members == null) {
            clack.log.error(`Could not find team "${team}". Are you sure you provided the correct team name?`)
            process.exitCode = 1
            return
        }

        if (members.length === 0) {
            clack.log.warn(`${team} has no members`)
            return
        }

        clack.log.message(members.map(toMemberLine).join('\n'))
    })
}

function toMemberLine(member: Member): string {
    const who = member.name ? `${member.name} (${chalk.greenBright(member.login)})` : chalk.greenBright(member.login)

    return `  ${authorToColorAvatar(member.login)} ${who} - ${chalk.blueBright(`https://github.com/${member.login}`)}`
}
