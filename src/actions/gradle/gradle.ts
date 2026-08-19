import * as clack from '@clack/prompts'
import chalk from 'chalk'

import { getGitterCache } from '../../common/git.ts'
import { updateRepoCache } from '../../common/repos.ts'
import { tuiSession, withSpinner } from '../../common/tui.ts'

import { EXPECTED_ALIAS, getInputRepo, InputRepo, TSM_INPUT_MODULE } from './tsm-input.ts'

/**
 * Reports which repos use no.nav.tsm.sykmelding:input, and which version they're on.
 */
export async function gradleTsmInput(): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm gradle tsm-input ')), async () => {
        const repos = await updateRepoCache(getGitterCache())

        const hits = await withSpinner(
            `Looking for ${TSM_INPUT_MODULE}`,
            async () => (await Promise.all(repos.map((repo) => getInputRepo(repo.name)))).filter((it) => it != null),
            (hits) => `Found ${chalk.yellow(hits.length)} repos using ${TSM_INPUT_MODULE}`,
        )

        if (hits.length === 0) {
            clack.log.warn(`No repos use ${TSM_INPUT_MODULE}`)
            return
        }

        clack.note(hits.map(toResultLine).join('\n'), 'tsm-sykmeldinger-input versions')
    })
}

function toResultLine(repo: InputRepo): string {
    const version = repo.version != null ? chalk.white(repo.version) : chalk.red('unknown version')

    if (repo.source === 'build.gradle.kts') {
        const declared = repo.variable != null ? `$${repo.variable} in build.gradle.kts` : 'inline in build.gradle.kts'

        return `${chalk.yellow('▲')} ${repo.name}: ${version} ${chalk.gray(`(${declared})`)}`
    }

    const deviations = [
        repo.alias !== EXPECTED_ALIAS ? `alias ${repo.alias}` : null,
        repo.versionRef == null
            ? 'version inlined in the catalog'
            : repo.versionRef !== EXPECTED_ALIAS
              ? `version.ref ${repo.versionRef}`
              : null,
    ].filter((it) => it != null)

    if (deviations.length > 0) {
        return `${chalk.yellow('▲')} ${repo.name}: ${version} ${chalk.gray(`(${deviations.join(', ')})`)}`
    } else if (repo.version == null) {
        return `${chalk.red('✗')} ${repo.name}: ${chalk.red(`${EXPECTED_ALIAS} not declared in libs.versions.toml`)}`
    } else {
        return `${chalk.green('✓')} ${repo.name}: ${version}`
    }
}
