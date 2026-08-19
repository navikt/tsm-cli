import * as clack from '@clack/prompts'
import chalk from 'chalk'

import { getGitterCache, Gitter } from '../../common/git.ts'
import { buildRepos, reportAndPush } from '../../common/gradle.ts'
import { updateRepoCache } from '../../common/repos.ts'
import { tuiSession, withSpinner } from '../../common/tui.ts'

import {
    EXPECTED_VERSION_VARIABLE,
    getKtorLibsRepo,
    getKtorRepo,
    getLatestTsmKtorVersion,
    KtorRepo,
    setKtorVersion,
} from './ktor-versions.ts'

const COMMIT_MESSAGE = 'automated: upgrade tsm-ktor libs'

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

        for (const repo of outdated) {
            await setKtorVersion(repo, latest)
        }

        const results = await buildRepos(outdated, latest)

        await reportAndPush(gitter, results, { file: 'settings.gradle.kts', commitMessage: COMMIT_MESSAGE })
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

function toResultLine({ name, variable, version }: KtorRepo): string {
    if (variable !== EXPECTED_VERSION_VARIABLE) {
        return `${chalk.red('✗')} ${name}: ${chalk.red(variable ?? 'no version variable')}`
    } else if (version == null) {
        return `${chalk.red('✗')} ${name}: ${chalk.red(`${variable} not declared in settings.gradle.kts`)}`
    } else {
        return `${chalk.green('✓')} ${name}: ${chalk.white(version)}`
    }
}
