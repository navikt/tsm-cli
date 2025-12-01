import * as R from 'remeda'
import chalk from 'chalk'

import { getAllRepos } from '../../../common/repos.ts'
import { getTeam } from '../../../common/config.ts'
import { getOctokitClient } from '../../../common/octokit.ts'
import { log, logNoNewLine } from '../../../common/log.ts'

const EXPECTED_REPO_SETTINGS = {
    default_branch: 'main',
    allow_rebase_merge: true,
    allow_squash_merge: true,
    has_issues: true,
    allow_merge_commit: false,
    has_projects: false,
    has_wiki: false,
} as const

export async function syncRepoSettings(): Promise<void> {
    const team = await getTeam()
    const repos = await getAllRepos(team)

    for (const repo of repos) {
        const wrongTuples = await checkSettingsOK(team, repo.name)

        if (wrongTuples.length === 0) {
            log(`${chalk.green('OK')} - ${chalk.blue(repo.name)}`)
        } else {
            log(`${chalk.blue(repo.name)} has the following wrong settings:`)
            log(wrongTuples.map(([setting, value]) => `  - ${chalk.yellow(setting)}: ${chalk.red(value)}`).join('\n'))

            logNoNewLine(chalk.yellow('Applying settings...'))
            try {
                await applySettings(team, repo.name)
                log(chalk.green(' OK!'))
            } catch (error) {
                log(chalk.red(` FAILED! :( (why: ${error})`))
            }
        }

        // Don't rate limit our selves
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
}

const expectedRepoSettingsPairs: [string, unknown][] = R.pipe(
    EXPECTED_REPO_SETTINGS,
    R.entries(),
    R.sortBy(([key]) => key),
)

export async function checkSettingsOK(team: string, repo: string): Promise<[string, unknown][]> {
    const octokit = getOctokitClient()

    const repoResponse = await octokit.request('GET /repos/{owner}/{repo}', {
        owner: 'navikt',
        repo: repo,
    })

    const repoSettings = R.pipe(
        repoResponse.data,
        R.pick([
            'default_branch',
            'allow_rebase_merge',
            'allow_squash_merge',
            'allow_merge_commit',
            'has_issues',
            'has_projects',
            'has_wiki',
        ]),
        R.entries(),
        R.sortBy(([key]) => key),
    )

    const diff: [string, unknown][] = []
    for (let i = 0; i < repoSettings.length; i++) {
        if (repoSettings[i][1] !== expectedRepoSettingsPairs[i][1]) {
            diff.push([repoSettings[i][0], repoSettings[i][1]])
        }
    }
    return diff
}

async function applySettings(team: string, repo: string): Promise<void> {
    const octokit = getOctokitClient()

    await octokit.request('PATCH /repos/{owner}/{repo}', {
        owner: 'navikt',
        repo: repo,
        ...R.omit(EXPECTED_REPO_SETTINGS, ['default_branch']),
    })
}
