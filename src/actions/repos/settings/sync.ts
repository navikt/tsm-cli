import * as clack from '@clack/prompts'
import chalk from 'chalk'
import * as R from 'remeda'

import { getTeam } from '../../../common/config.ts'
import { getOctokitClient } from '../../../common/octokit.ts'
import { getAllRepos } from '../../../common/repos.ts'
import { tuiSession, withSpinner } from '../../../common/tui.ts'

const EXPECTED_REPO_SETTINGS = {
    default_branch: 'main',
    allow_rebase_merge: true,
    allow_squash_merge: true,
    has_issues: true,
    allow_merge_commit: false,
    has_projects: false,
    has_wiki: false,
} as const

type SettingKey = keyof typeof EXPECTED_REPO_SETTINGS

/** How many repos we hit github with at the same time, to avoid getting rate limited. */
const CONCURRENCY = 5

type WrongSetting = { setting: SettingKey; actual: unknown; expected: unknown }

export async function syncRepoSettings(): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm repos --sync-settings ')), async () => {
        const team = await getTeam()

        const repos = await withSpinner(
            `Fetching repos for ${chalk.yellow(team)}`,
            () => getAllRepos(team),
            (repos) => `Found ${chalk.yellow(repos.length)} repos in ${chalk.yellow(team)}`,
        )

        const outdated = await checkAllRepos(repos.map((it) => it.name))

        if (outdated.length === 0) {
            clack.log.success(`All ${repos.length} repos have the expected settings`)
            return
        }

        clack.note(outdated.map(toDiffSection).join('\n\n'), `${outdated.length} repos with wrong settings`)

        const confirmed = await clack.confirm({ message: `Apply expected settings to ${outdated.length} repos?` })

        if (clack.isCancel(confirmed) || !confirmed) {
            clack.log.warn('Aborting, no settings were changed')
            return
        }

        await applyAll(outdated.map((it) => it.repo))
    })
}

async function checkAllRepos(repos: string[]): Promise<{ repo: string; wrong: WrongSetting[] }[]> {
    return await withSpinner(
        `Checking settings in ${repos.length} repos`,
        async (spinner) => {
            let done = 0

            const results = await mapWithConcurrency(repos, async (repo) => {
                const wrong = await checkSettings(repo)
                spinner.message(`Checking settings in ${repos.length} repos (${++done}/${repos.length})`)

                return { repo, wrong }
            })

            return results.filter((it) => it.wrong.length > 0)
        },
        (outdated) =>
            outdated.length === 0
                ? `Checked ${chalk.yellow(repos.length)} repos, all OK`
                : `Checked ${chalk.yellow(repos.length)} repos, ${chalk.red(outdated.length)} need changes`,
    )
}

async function applyAll(repos: string[]): Promise<void> {
    await withSpinner(
        'Applying settings',
        async (spinner) => {
            const errors: string[] = []
            let done = 0

            await mapWithConcurrency(repos, async (repo) => {
                try {
                    await applySettings(repo)
                } catch (e) {
                    errors.push(`${repo}: ${e as Error}`)
                }

                spinner.message(`Applying settings (${++done}/${repos.length})`)
            })

            return errors
        },
        (errors) =>
            errors.length === 0
                ? `Applied settings to ${chalk.green(repos.length)} repos`
                : `Applied settings to ${chalk.green(repos.length - errors.length)} repos, ${chalk.red(
                      errors.length,
                  )} failed:\n${chalk.gray(errors.join('\n'))}`,
    )
}

/**
 * Runs `fn` over every item, keeping at most `CONCURRENCY` requests in flight, since github
 * rate limits us if we fire off everything at once.
 */
async function mapWithConcurrency<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = Array.from({ length: items.length })
    let next = 0

    const workers = R.range(0, Math.min(CONCURRENCY, items.length)).map(async () => {
        while (next < items.length) {
            const index = next++
            results[index] = await fn(items[index])
        }
    })

    await Promise.all(workers)

    return results
}

async function checkSettings(repo: string): Promise<WrongSetting[]> {
    const { data } = await getOctokitClient().request('GET /repos/{owner}/{repo}', {
        owner: 'navikt',
        repo: repo,
    })

    return R.pipe(
        EXPECTED_REPO_SETTINGS,
        R.entries(),
        R.map(([setting, expected]) => ({ setting, expected, actual: data[setting] })),
        R.filter((it) => it.actual !== it.expected),
        R.sortBy((it) => it.setting),
    )
}

async function applySettings(repo: string): Promise<void> {
    await getOctokitClient().request('PATCH /repos/{owner}/{repo}', {
        owner: 'navikt',
        repo: repo,
        ...R.omit(EXPECTED_REPO_SETTINGS, ['default_branch']),
    })
}

function toDiffSection({ repo, wrong }: { repo: string; wrong: WrongSetting[] }): string {
    const lines = wrong.map(
        ({ setting, actual, expected }) =>
            `  ${chalk.yellow(setting)}: ${chalk.red(String(actual))} → ${chalk.green(String(expected))}`,
    )

    return [chalk.blue(repo), ...lines].join('\n')
}
