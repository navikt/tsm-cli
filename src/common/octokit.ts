import chalk from 'chalk'
import { Octokit } from 'octokit'
import * as R from 'remeda'

import { log } from './log.ts'
import { blacklisted } from './repos.ts'

let packagesOctokit: Octokit | null = null
let cliOctokit: Octokit | null = null

export function getOctokitClient(auth: 'cli' | 'package' = 'cli'): Octokit {
    switch (auth) {
        case 'cli':
            if (cliOctokit === null) {
                cliOctokit = new Octokit({ auth: getGithubCliToken() })
            }

            return cliOctokit
        case 'package':
            if (Bun.env.NPM_AUTH_TOKEN == null) {
                throw new Error('No NPM_AUTH_TOKEN set')
            }

            if (packagesOctokit === null) {
                packagesOctokit = new Octokit({ auth: Bun.env.NPM_AUTH_TOKEN })
            }

            return packagesOctokit
    }
}

/**
 * Wrapper to enforce types
 */
export async function ghGqlQuery<Result = never>(
    query: string,
    variables?: Record<string, unknown>,
): GraphQLResponse<Result> {
    return await getOctokitClient().graphql<GraphQLResponse<Result>>(query, variables)
}

function getGithubCliToken(): string {
    const subProcess = Bun.spawnSync('gh auth status --show-token'.split(' '))
    const stdout = subProcess.stdout.toString()
    const stderr = subProcess.stderr.toString()

    // gh-cli puts the token on stderr, probably because security, but only on linux??? Lol
    const output = stdout.includes('Logged in to github.com') ? stdout : stderr
    const data: string | null = output.match(/Token: (.*)/)?.[1] ?? null

    if (!data?.trim()) {
        log(chalk.red(`Could not get github cli token. Please run 'gh auth login' and try again.`))
        process.exit(1)
    }

    return data
}

export type GraphQLResponse<Data> = Promise<Data>

export const BaseRepoNodeFragment = /* GraphQL */ `
    fragment BaseRepoNode on Repository {
        name
        isArchived
        pushedAt
        url
        defaultBranchRef {
            name
        }
    }
`

export type BaseRepoNode<AdditionalRepoProps> = {
    name: string
    isArchived: boolean
    pushedAt: string
    url: string
    defaultBranchRef: {
        name: string
    }
} & AdditionalRepoProps

export type OrgTeamResult<Result> = {
    organization: {
        team: Result
    }
}

export type OrgTeamRepoResult<AdditionalRepoProps> = OrgTeamResult<{
    repositories: {
        nodes: BaseRepoNode<AdditionalRepoProps>[]
    }
}>

export const removeIgnoredAndArchived: <AdditionalRepoProps>(
    nodes: BaseRepoNode<AdditionalRepoProps>[],
) => BaseRepoNode<AdditionalRepoProps>[] = R.piped(
    R.filter((it) => !it.isArchived),
    R.filter(blacklisted),
)
