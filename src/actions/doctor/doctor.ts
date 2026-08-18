import * as clack from '@clack/prompts'
import chalk from 'chalk'
import * as R from 'remeda'

import { tuiSession, withSpinner } from '../../common/tui.ts'

import { badBrews } from './brew.ts'
import { checkGithubCli, checkKubectl, checkPatTokenNpm, defaultExistsCheck } from './checks.ts'
import { missingClis } from './clis.ts'
import { REQUIRED_ACTIONS } from './config.ts'

const CHECKS = {
    gh: checkGithubCli,
    kubectl: checkKubectl,
    nais: () => defaultExistsCheck('nais', `nais --version`),
    gcloud: () => defaultExistsCheck('gcloud', `gcloud --version`),
    mise: () => defaultExistsCheck('mise', `mise --version`),
    'PAT token (npm)': checkPatTokenNpm,
} satisfies Record<(typeof REQUIRED_ACTIONS)[number], () => Promise<string | null>>

export async function runDoctor(): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm doctor ')), async () => {
        const missing = missingClis()
        if (missing.length > 0) {
            clack.log.error(
                `The following CLIs are missing:\n${missing.map((it) => `  - ${chalk.bold(it)}`).join('\n')}`,
            )
            clack.log.info('Please install all missing tools and try again. :)')
            return
        }

        const { okChecks, failedChecks } = await withSpinner(
            `Verifying your setup (${Object.keys(CHECKS).length} checks)`,
            () => applyChecks(),
            ({ okChecks, failedChecks }) =>
                failedChecks.length === 0
                    ? `All ${chalk.green(okChecks.length)} checks passed`
                    : `${chalk.green(okChecks.length)} checks passed, ${chalk.red(failedChecks.length)} failed`,
        )

        const badBrew = await withSpinner(
            'Looking for tools installed with brew',
            () => badBrews(),
            (bad) =>
                bad.length === 0
                    ? 'No tools are wrongly installed with brew'
                    : `${chalk.red(bad.length)} tools are installed with brew`,
        )

        if (okChecks.length > 0) {
            clack.note(okChecks.map((cli) => `${chalk.green('✓')} ${cli}`).join('\n'), 'These checks are good')
        }

        if (badBrew.length > 0) {
            clack.log.warn(
                `The following CLIs are installed with ${chalk.red('brew')} and shouldn't be:\n` +
                    badBrew.map((it) => `  - ${chalk.bold(it)}`).join('\n'),
            )
        }

        if (failedChecks.length > 0) {
            clack.log.error(
                `The following checks were not happy:\n` +
                    failedChecks.map(([cli, result]) => `  - ${chalk.bold(cli)}: ${chalk.yellow(result)}`).join('\n'),
            )
        } else if (badBrew.length === 0) {
            clack.log.success('Everything is OK')
        }
    })
}

async function applyChecks(): Promise<{
    okChecks: string[]
    failedChecks: [string, string][]
}> {
    const results = await R.pipe(
        R.entries(CHECKS),
        R.map(async ([cli, check]) => [cli, await check()] as const),
        (it) => Promise.all(it),
    )
    const [bad, ok] = R.partition(results, checkResultGuard)

    return {
        okChecks: ok.map(([cli]) => cli),
        failedChecks: bad,
    }
}

function checkResultGuard(resultTuple: readonly [string, string | null]): resultTuple is [string, string] {
    return resultTuple[1] != null
}
