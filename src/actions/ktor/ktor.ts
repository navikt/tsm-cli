import * as clack from '@clack/prompts'
import chalk from 'chalk'

import { getTeam } from '../../common/config.ts'
import { getGitterCache, Gitter } from '../../common/git.ts'
import { getAllRepos } from '../../common/repos.ts'
import { tuiSession, withSpinner } from '../../common/tui.ts'

import { gradleBuild } from './gradle.ts'
import {
    EXPECTED_VERSION_VARIABLE,
    getKtorLibsRepo,
    getKtorRepo,
    getLatestTsmKtorVersion,
    KtorRepo,
    setKtorVersion,
} from './ktor-versions.ts'

const COMMIT_MESSAGE = 'automated: upgrade tsm-ktor libs'

/** Gradle builds are heavy, so only run a few at a time. */
const BUILD_CONCURRENCY = 4

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

/**
 * Assumes versions and sanity checks from `tsm ktor` are OK, and only reports which tsm-ktor
 * library modules each app refers to through the `tsmKtorLibs` version catalog.
 */
export async function ktorInfo(): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm ktor info ')), async () => {
        const repos = await updateRepoCache(getGitterCache())

        const withLibs = await withSpinner(
            'Looking for tsmKtorLibs usage',
            async () => (await Promise.all(repos.map((repo) => getKtorLibsRepo(repo.name)))).filter((it) => it != null),
            (hits) => `Found ${chalk.yellow(hits.length)} repos using tsmKtorLibs`,
        )

        if (withLibs.length === 0) {
            clack.log.warn('No repos use tsmKtorLibs')
            return
        }

        clack.note(
            withLibs
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((it) => {
                    const libs = [...it.libs].sort(compareLibs)

                    return [
                        chalk.white(it.name),
                        ...libs.map((lib, index) => {
                            const branch = index === libs.length - 1 ? '└─' : '├─'

                            return `${chalk.gray(branch)} ${chalk.cyan(libGlyph(lib))} ${chalk.gray(lib)}`
                        }),
                    ].join('\n')
                })
                .join('\n\n'),
            'tsm-ktor modules in use',
        )
    })
}

const LIB_GLYPHS: Record<string, string> = {
    core: '◆',
    auth: '⚿',
    kafka: '⇄',
    'kafka.sykmeldinger': '⚕',
    'kafka.test': '⚗',
}

/**
 * Best-effort glyph for a lib, falling back to the parent module's glyph, e.g. `kafka.foo` → ⇄.
 */
function libGlyph(lib: string): string {
    const segments = lib.split('.')

    for (let i = segments.length; i > 0; i--) {
        const glyph = LIB_GLYPHS[segments.slice(0, i).join('.')] ?? LIB_GLYPHS[segments[i - 1]]

        if (glyph != null) return glyph
    }

    return '·'
}

/**
 * Orders libs by the known order in `LIB_GLYPHS` (core first), unknown libs last and alphabetically.
 */
function compareLibs(a: string, b: string): number {
    const order = Object.keys(LIB_GLYPHS)
    const aIndex = order.indexOf(a)
    const bIndex = order.indexOf(b)

    if (aIndex === bIndex) return a.localeCompare(b)

    return (aIndex === -1 ? order.length : aIndex) - (bIndex === -1 ? order.length : bIndex)
}

async function findKtorRepos(gitter: Gitter): Promise<KtorRepo[]> {
    const repos = await updateRepoCache(gitter)

    return await withSpinner(
        'Looking for no.nav.tsm:ktor',
        async () => (await Promise.all(repos.map((repo) => getKtorRepo(repo.name)))).filter((it) => it != null),
        (hits) => `Found ${chalk.yellow(hits.length)} repos using no.nav.tsm:ktor`,
    )
}

async function updateRepoCache(gitter: Gitter): Promise<Awaited<ReturnType<typeof getAllRepos>>> {
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

    return repos
}

/**
 * Bumps the version and builds the repos, a few at a time, since gradle builds are heavy.
 */
async function upgradeRepos(repos: KtorRepo[], version: string): Promise<UpdateResult[]> {
    for (const repo of repos) {
        await setKtorVersion(repo, version)
    }

    return await withSpinner(
        `Building ${repos.length} repos: ./gradlew clean build test`,
        async (spinner) => {
            const results: UpdateResult[] = []
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
