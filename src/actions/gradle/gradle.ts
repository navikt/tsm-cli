import * as clack from '@clack/prompts'
import chalk from 'chalk'

import { getGitterCache } from '../../common/git.ts'
import { buildRepos, reportAndPush } from '../../common/gradle.ts'
import { updateRepoCache } from '../../common/repos.ts'
import { tuiSession, withSpinner } from '../../common/tui.ts'

import {
    CATALOG_FILE,
    EXPECTED_ALIAS,
    getInputRepo,
    getLatestTsmInputVersion,
    InputRepo,
    isUpdatable,
    setInputVersion,
    TSM_INPUT_MODULE,
} from './tsm-input.ts'

const COMMIT_MESSAGE = 'automated: upgrade tsm-sykmelding-input'

/**
 * Reports which repos use no.nav.tsm.sykmelding:input, and which version they're on.
 */
export async function gradleTsmInput(update: boolean): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm gradle tsm-input ')), async () => {
        const gitter = getGitterCache()
        const repos = await updateRepoCache(gitter)

        const hits = await withSpinner(
            `Looking for ${TSM_INPUT_MODULE}`,
            async () => (await Promise.all(repos.map((repo) => getInputRepo(repo.name)))).filter((it) => it != null),
            (hits) => `Found ${chalk.yellow(hits.length)} repos using ${TSM_INPUT_MODULE}`,
        )

        if (hits.length === 0) {
            clack.log.warn(`No repos use ${TSM_INPUT_MODULE}`)
            return
        }

        if (!update) {
            clack.note(hits.map(toResultLine).join('\n'), 'tsm-sykmeldinger-input versions')
            return
        }

        const latest = await withSpinner(
            'Fetching latest tsm-sykmelding-input release',
            () => getLatestTsmInputVersion(),
            (version) => `Latest tsm-sykmelding-input release is ${chalk.yellow(version)}`,
        )

        const skipped = hits.filter((it) => !isUpdatable(it))

        if (skipped.length > 0) {
            clack.log.warn(
                `Skipping ${skipped.length} incorrectly configured repos:\n${skipped.map(toResultLine).join('\n')}`,
            )
        }

        const outdated = hits.filter((it) => isUpdatable(it) && it.version !== latest)

        if (outdated.length === 0) {
            clack.log.success(`All ${hits.length - skipped.length} updatable repos are already on ${latest}`)
            return
        }

        clack.note(
            outdated.map((it) => `${it.name}: ${chalk.red(it.version)} → ${chalk.green(latest)}`).join('\n'),
            `${outdated.length} repos to upgrade`,
        )

        for (const repo of outdated) {
            await setInputVersion(repo, latest)
        }

        const results = await buildRepos(outdated, latest)

        await reportAndPush(gitter, results, { file: CATALOG_FILE, commitMessage: COMMIT_MESSAGE })
    })
}

function toResultLine(repo: InputRepo): string {
    const version = repo.version != null ? chalk.white(repo.version) : chalk.red('unknown version')

    if (repo.source === 'build.gradle.kts') {
        const declared = repo.variable != null ? `$${repo.variable} in build.gradle.kts` : 'inline in build.gradle.kts'

        return `${chalk.yellow('▲')} ${repo.name}: ${version} ${chalk.gray(`(${declared})`)}`
    } else if (repo.versionRef == null) {
        return `${chalk.yellow('▲')} ${repo.name}: ${version} ${chalk.gray('(version inlined in the catalog)')}`
    } else if (repo.versionRef !== EXPECTED_ALIAS) {
        return `${chalk.yellow('▲')} ${repo.name}: ${version} ${chalk.gray(`(version.ref ${repo.versionRef})`)}`
    } else if (repo.version == null) {
        return `${chalk.red('✗')} ${repo.name}: ${chalk.red(`${EXPECTED_ALIAS} not declared in ${CATALOG_FILE}`)}`
    } else if (repo.alias !== EXPECTED_ALIAS) {
        return `${chalk.yellow('▲')} ${repo.name}: ${version} ${chalk.gray(`(alias ${repo.alias})`)}`
    }

    return `${chalk.green('✓')} ${repo.name}: ${version}`
}
