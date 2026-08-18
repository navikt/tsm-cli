import * as clack from '@clack/prompts'
import chalk from 'chalk'

import { getTeam } from '../../common/config.ts'
import { getGitterCache, Gitter } from '../../common/git.ts'
import { getAllRepos } from '../../common/repos.ts'
import { tuiSession, withSpinner } from '../../common/tui.ts'

import { gradleBuild } from './gradle.ts'
import {
    EXPECTED_VERSION_VARIABLE,
    getKtorRepo,
    getLatestTsmKtorVersion,
    KtorRepo,
    setKtorVersion,
} from './ktor-versions.ts'

const COMMIT_MESSAGE = 'automated: upgrade tsm-ktor libs'

type UpdateResult = { repo: KtorRepo; ok: true } | { repo: KtorRepo; ok: false; output: string }

export async function ktor(update: boolean): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm ktor ')), async () => {
        const gitter = getGitterCache()
        const ktorRepos = await findKtorRepos(gitter)

        if (!update) {
            clack.note(ktorRepos.map(toResultLine).join('\n'), 'tsm ktor versions')
            return
        }

        const latest = await withSpinner(
            'Fetching latest tsm-ktor release',
            () => getLatestTsmKtorVersion(),
            (version) => `Latest tsm-ktor release is ${chalk.yellow(version)}`,
        )

        const outdated = ktorRepos.filter(
            (it) => it.variable === EXPECTED_VERSION_VARIABLE && it.version !== latest && it.version != null,
        )

        if (outdated.length === 0) {
            clack.log.success(`All ${ktorRepos.length} repos are already on ${latest}`)
            return
        }

        clack.note(
            outdated.map((it) => `${it.name}: ${chalk.red(it.version)} → ${chalk.green(latest)}`).join('\n'),
            `${outdated.length} repos to upgrade`,
        )

        const results = await upgradeRepos(outdated, latest)

        await reportAndPush(gitter, results)
    })
}

async function findKtorRepos(gitter: Gitter): Promise<KtorRepo[]> {
    const team = await getTeam()

    const repos = await withSpinner(
        `Fetching repos for ${team}`,
        () => getAllRepos(team),
        (repos) => `Found ${chalk.yellow(repos.length)} repos in ${chalk.yellow(team)}`,
    )

    await withSpinner(
        'Updating local git cache',
        async (spinner) => {
            let done = 0

            await Promise.all(
                repos.map(async (repo) => {
                    await gitter.cloneOrPull(repo.name, repo.defaultBranchRef.name, true)
                    spinner.message(`Updating local git cache (${++done}/${repos.length})`)
                }),
            )
        },
        () => `Updated ${chalk.yellow(repos.length)} repos`,
    )

    return await withSpinner(
        'Looking for no.nav.tsm:ktor',
        async () => (await Promise.all(repos.map((repo) => getKtorRepo(repo.name)))).filter((it) => it != null),
        (hits) => `Found ${chalk.yellow(hits.length)} repos using no.nav.tsm:ktor`,
    )
}

/**
 * Bumps the version and builds each repo, one at a time, since gradle builds are heavy.
 */
async function upgradeRepos(repos: KtorRepo[], version: string): Promise<UpdateResult[]> {
    const results: UpdateResult[] = []

    for (const [index, repo] of repos.entries()) {
        await setKtorVersion(repo, version)

        const result = await withSpinner(
            `[${index + 1}/${repos.length}] ${repo.name}: ./gradlew clean build test`,
            async (spinner) => {
                const started = performance.now()
                const interval = setInterval(() => {
                    const seconds = Math.round((performance.now() - started) / 1000)
                    spinner.message(
                        `[${index + 1}/${repos.length}] ${repo.name}: ./gradlew clean build test (${seconds}s)`,
                    )
                }, 1000)

                try {
                    return await gradleBuild(repo.name)
                } finally {
                    clearInterval(interval)
                }
            },
            (result) =>
                result.ok
                    ? `${chalk.green('✓')} ${repo.name} built OK on ${version}`
                    : `${chalk.red('✗')} ${repo.name} failed to build on ${version}`,
        )

        results.push(result.ok ? { repo, ok: true } : { repo, ok: false, output: result.output })
    }

    return results
}

async function reportAndPush(gitter: Gitter, results: UpdateResult[]): Promise<void> {
    const failed = results.filter((it) => !it.ok)
    const succeeded = results.filter((it) => it.ok)

    for (const failure of failed) {
        clack.log.error(`${failure.repo.name} failed:\n${chalk.gray(failure.output)}`)

        // Leave the cached checkout clean, the change is easy to redo
        await gitter.createRepoGitClient(failure.repo.name).checkout(['--', 'settings.gradle.kts'])
    }

    if (succeeded.length === 0) {
        clack.log.warn('No repos were upgraded successfully, nothing to push')
        return
    }

    clack.note(succeeded.map((it) => `${chalk.green('✓')} ${it.repo.name}`).join('\n'), 'Ready to push')

    const confirmed = await clack.confirm({
        message: `Commit and push ${succeeded.length} repos with "${COMMIT_MESSAGE}"?`,
    })

    if (clack.isCancel(confirmed) || !confirmed) {
        clack.log.warn('Aborting, no changes were committed or pushed')
        return
    }

    await withSpinner(
        'Pushing changes',
        async (spinner) => {
            let done = 0

            for (const { repo } of succeeded) {
                await gitter
                    .createRepoGitClient(repo.name)
                    .add('settings.gradle.kts')
                    .commit(COMMIT_MESSAGE, ['--no-verify'])
                    .push()

                spinner.message(`Pushing changes (${++done}/${succeeded.length})`)
            }
        },
        () => `Pushed changes in ${chalk.green(succeeded.length)} repos`,
    )
}

function toResultLine({ name, variable, version }: KtorRepo): string {
    if (variable !== EXPECTED_VERSION_VARIABLE) {
        return `${chalk.red('✗')} ${name}: ${chalk.red(variable ?? 'no version variable')}`
    } else if (version == null) {
        return `${chalk.red('✗')} ${name}: ${chalk.red(`${variable} not declared in settings.gradle.kts`)}`
    } else {
        return `${chalk.green('✓')} ${name}: ${chalk.white(version)}`
    }
}
