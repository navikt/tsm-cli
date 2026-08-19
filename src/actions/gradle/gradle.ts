import * as clack from '@clack/prompts'
import chalk from 'chalk'

import { getGitterCache } from '../../common/git.ts'
import { buildRepos, reportAndPush } from '../../common/gradle.ts'
import { updateRepoCache } from '../../common/repos.ts'
import { tuiSession, withSpinner } from '../../common/tui.ts'

import {
    CATALOG_FILE,
    findLibRepos,
    findLibUsage,
    isUpdatable,
    LibSpec,
    LibUsage,
    setCatalogVersion,
    toUsageLine,
} from './catalog-lib.ts'
import { getLatestRegulaVersion, libName, REGULA_LIBS } from './regula.ts'
import { getLatestTsmInputVersion, TSM_INPUT } from './tsm-input.ts'

const TSM_INPUT_COMMIT_MESSAGE = 'automated: upgrade tsm-sykmelding-input'
const REGULA_COMMIT_MESSAGE = 'automated: upgrade regulus-regula libs'

/**
 * Reports which repos use no.nav.tsm.sykmelding:input, and which version they're on.
 */
export async function gradleTsmInput(update: boolean): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm gradle tsm-input ')), async () => {
        const gitter = getGitterCache()
        const repos = await updateRepoCache(gitter)

        const hits = await withSpinner(
            `Looking for ${TSM_INPUT.module}`,
            () =>
                findLibRepos(
                    repos.map((it) => it.name),
                    TSM_INPUT,
                ),
            (hits) => `Found ${chalk.yellow(hits.length)} repos using ${TSM_INPUT.module}`,
        )

        if (hits.length === 0) {
            clack.log.warn(`No repos use ${TSM_INPUT.module}`)
            return
        }

        if (!update) {
            clack.note(
                hits.map((it) => toUsageLine(it.name, it.usage, TSM_INPUT)).join('\n'),
                `${TSM_INPUT.expectedAlias} versions`,
            )
            return
        }

        const latest = await withSpinner(
            'Fetching latest tsm-sykmelding-input release',
            () => getLatestTsmInputVersion(),
            (version) => `Latest tsm-sykmelding-input release is ${chalk.yellow(version)}`,
        )

        const skipped = hits.filter((it) => !isUpdatable(it.usage, TSM_INPUT))

        if (skipped.length > 0) {
            clack.log.warn(
                `Skipping ${skipped.length} incorrectly configured repos:\n${skipped
                    .map((it) => toUsageLine(it.name, it.usage, TSM_INPUT))
                    .join('\n')}`,
            )
        }

        const outdated = hits.filter((it) => isUpdatable(it.usage, TSM_INPUT) && it.usage.version !== latest)

        if (outdated.length === 0) {
            clack.log.success(`All ${hits.length - skipped.length} updatable repos are already on ${latest}`)
            return
        }

        clack.note(
            outdated.map((it) => `${it.name}: ${chalk.red(it.usage.version)} → ${chalk.green(latest)}`).join('\n'),
            `${outdated.length} repos to upgrade`,
        )

        for (const repo of outdated) {
            await setCatalogVersion(repo, TSM_INPUT, latest)
        }

        const results = await buildRepos(outdated, latest)

        await reportAndPush(gitter, results, { file: CATALOG_FILE, commitMessage: TSM_INPUT_COMMIT_MESSAGE })
    })
}

/**
 * Reports which repos use the regulus-regula libs, and which versions they're on.
 */
export async function gradleRegula(update: boolean): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm gradle regula ')), async () => {
        const gitter = getGitterCache()
        const repos = await updateRepoCache(gitter)

        const hits = await withSpinner(
            `Looking for ${REGULA_LIBS.map((it) => it.module).join(' and ')}`,
            async () =>
                (await Promise.all(repos.map(({ name }) => findRegulaLibs(name)))).filter((it) => it.libs.length > 0),
            (hits) => `Found ${chalk.yellow(hits.length)} repos using regulus-regula libs`,
        )

        if (hits.length === 0) {
            clack.log.warn('No repos use the regulus-regula libs')
            return
        }

        if (!update) {
            clack.note(hits.map(toRepoLines).join('\n\n'), 'regulus-regula versions')
            return
        }

        const latest = await withSpinner(
            'Fetching latest regulus-regula release',
            () => getLatestRegulaVersion(),
            (version) => `Latest regulus-regula release is ${chalk.yellow(version)}`,
        )

        const skipped = hits
            .map(({ name, libs }) => ({ name, libs: libs.filter((it) => !isUpdatable(it.usage, it.spec)) }))
            .filter((it) => it.libs.length > 0)

        if (skipped.length > 0) {
            clack.log.warn(`Skipping incorrectly configured libs:\n${skipped.map(toRepoLines).join('\n\n')}`)
        }

        const outdated = hits
            .map(({ name, libs }) => ({
                name,
                libs: libs.filter((it) => isUpdatable(it.usage, it.spec) && it.usage.version !== latest),
            }))
            .filter((it) => it.libs.length > 0)

        if (outdated.length === 0) {
            clack.log.success(`All updatable repos are already on ${latest}`)
            return
        }

        clack.note(
            outdated
                .map(({ name, libs }) =>
                    [
                        chalk.white(name),
                        ...libs.map(
                            ({ spec, usage }) =>
                                `  ${libName(spec)}: ${chalk.red(usage.version)} → ${chalk.green(latest)}`,
                        ),
                    ].join('\n'),
                )
                .join('\n\n'),
            `${outdated.length} repos to upgrade`,
        )

        for (const { name, libs } of outdated) {
            for (const { spec, usage } of libs) {
                await setCatalogVersion({ name, usage }, spec, latest)
            }
        }

        const results = await buildRepos(outdated, latest)

        await reportAndPush(gitter, results, { file: CATALOG_FILE, commitMessage: REGULA_COMMIT_MESSAGE })
    })
}

type RegulaRepo = { name: string; libs: { spec: LibSpec; usage: LibUsage }[] }

/**
 * All regulus-regula libs a single repo uses.
 */
async function findRegulaLibs(name: string): Promise<RegulaRepo> {
    const libs = await Promise.all(REGULA_LIBS.map(async (spec) => ({ spec, usage: await findLibUsage(name, spec) })))

    return { name, libs: libs.filter((it): it is { spec: LibSpec; usage: LibUsage } => it.usage != null) }
}

/** The repo name, with one line per lib it uses. */
function toRepoLines({ name, libs }: RegulaRepo): string {
    return [
        chalk.white(name),
        ...libs.map(({ spec, usage }, index) => {
            const branch = index === libs.length - 1 ? '└─' : '├─'

            return `${chalk.gray(branch)} ${toUsageLine(libName(spec), usage, spec)}`
        }),
    ].join('\n')
}
