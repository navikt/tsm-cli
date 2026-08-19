import * as clack from '@clack/prompts'
import chalk from 'chalk'
import path from 'node:path'

import { GIT_CACHE_DIR } from './cache.ts'
import { Gitter } from './git.ts'
import { withSpinner } from './tui.ts'

/** Gradle builds are heavy, so only run a few at a time. */
const BUILD_CONCURRENCY = 4

export type GradleResult = { ok: true } | { ok: false; output: string }

export type UpgradeResult<Repo extends { name: string }> =
    | { repo: Repo; ok: true }
    | { repo: Repo; ok: false; output: string }

/**
 * Runs `./gradlew clean build test` in the repo's cached checkout.
 */
export async function gradleBuild(repo: string): Promise<GradleResult> {
    const proc = Bun.spawn(['./gradlew', 'clean', 'build', 'test'], {
        cwd: path.join(GIT_CACHE_DIR, repo),
        stdout: 'pipe',
        stderr: 'pipe',
    })

    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])

    if (exitCode === 0) {
        return { ok: true }
    }

    return { ok: false, output: lastLines(`${stdout}\n${stderr}`, 20) }
}

/**
 * Builds the repos, a few at a time, since gradle builds are heavy. Assumes the version bump has
 * already been written to each repo's cached checkout.
 */
export async function buildRepos<Repo extends { name: string }>(
    repos: Repo[],
    version: string,
): Promise<UpgradeResult<Repo>[]> {
    return await withSpinner(
        `Building ${repos.length} repos: ./gradlew clean build test`,
        async (spinner) => {
            const results: UpgradeResult<Repo>[] = []
            const queue = [...repos]
            const running = new Set<string>()
            const started = performance.now()

            const render = (): void => {
                const seconds = Math.round((performance.now() - started) / 1000)

                spinner.message(
                    `[${results.length}/${repos.length}] building (${seconds}s): ${[...running].join(', ')}`,
                )
            }

            const interval = setInterval(render, 1000)

            const worker = async (): Promise<void> => {
                for (let repo = queue.shift(); repo != null; repo = queue.shift()) {
                    running.add(repo.name)
                    render()

                    const result = await gradleBuild(repo.name)

                    running.delete(repo.name)
                    results.push(result.ok ? { repo, ok: true } : { repo, ok: false, output: result.output })

                    clack.log[result.ok ? 'success' : 'error'](
                        result.ok
                            ? `${chalk.green('✓')} ${repo.name} built OK on ${version}`
                            : `${chalk.red('✗')} ${repo.name} failed to build on ${version}`,
                    )
                    render()
                }
            }

            try {
                await Promise.all(Array.from({ length: Math.min(BUILD_CONCURRENCY, queue.length) }, () => worker()))
            } finally {
                clearInterval(interval)
            }

            // Keep the reporting order stable, regardless of which build finished first
            return repos.map((repo) => results.find((it) => it.repo.name === repo.name)).filter((it) => it != null)
        },
        (results) => {
            const failed = results.filter((it) => !it.ok).length

            return failed === 0
                ? `${chalk.green('✓')} All ${results.length} repos built OK on ${version}`
                : `${chalk.red('✗')} ${failed} of ${results.length} repos failed to build on ${version}`
        },
    )
}

/**
 * Logs failed builds (and reverts their changes), then offers to commit and push the ones that
 * built OK.
 */
export async function reportAndPush<Repo extends { name: string }>(
    gitter: Gitter,
    results: UpgradeResult<Repo>[],
    { file, commitMessage }: { file: string; commitMessage: string },
): Promise<void> {
    const failed = results.filter((it) => !it.ok)
    const succeeded = results.filter((it) => it.ok)

    for (const failure of failed) {
        clack.log.error(`${failure.repo.name} failed:\n${chalk.gray(failure.output)}`)

        // Leave the cached checkout clean, the change is easy to redo
        await gitter.createRepoGitClient(failure.repo.name).checkout(['--', file])
    }

    if (succeeded.length === 0) {
        clack.log.warn('No repos were upgraded successfully, nothing to push')
        return
    }

    clack.note(succeeded.map((it) => `${chalk.green('✓')} ${it.repo.name}`).join('\n'), 'Ready to push')

    const confirmed = await clack.confirm({
        message: `Commit and push ${succeeded.length} repos with "${commitMessage}"?`,
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
                await gitter.createRepoGitClient(repo.name).add(file).commit(commitMessage, ['--no-verify']).push()

                spinner.message(`Pushing changes (${++done}/${succeeded.length})`)
            }
        },
        () => `Pushed changes in ${chalk.green(succeeded.length)} repos`,
    )
}

function lastLines(output: string, count: number): string {
    return output.trim().split('\n').slice(-count).join('\n').trim()
}
