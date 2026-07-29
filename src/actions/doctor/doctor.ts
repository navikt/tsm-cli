import chalk from 'chalk'
import * as R from 'remeda'

import { log } from '../../common/log.ts'

import { badBrews } from './brew.ts'
import { checkGithubCli, checkKubectl, checkPatTokenMvn, checkPatTokenNpm, defaultExistsCheck } from './checks.ts'
import { missingClis } from './clis.ts'
import { REQUIRED_ACTIONS } from './config.ts'

const CHECKS = {
    gh: checkGithubCli,
    kubectl: checkKubectl,
    nais: () => defaultExistsCheck('nais', `nais --version`),
    gcloud: () => defaultExistsCheck('gcloud', `gcloud --version`),
    'PAT token (npm)': checkPatTokenNpm,
    'PAT token (mvn)': checkPatTokenMvn,
} satisfies Record<(typeof REQUIRED_ACTIONS)[number], () => Promise<string | null>>

export async function runDoctor(): Promise<void> {
    log(chalk.blueBright('Verifying your setup...'))
    const missing = missingClis()
    if (missing.length > 0) {
        log(
            `The following CLIs are missing:\n`,
            chalk.red(missing.map((it) => ` - ${chalk.bold(it)}`)),
            '\n\nPlease install all missing tools and try again. :)',
        )
        return
    }

    const { okChecks, failedChecks } = await applyChecks()
    if (okChecks.length) {
        log(chalk.green(`The following checks are good!`))
        log(chalk.red(okChecks.map((cli) => ` ${chalk.green('✓')} ${chalk.white(cli)}`).join('\n')))
    }

    const badBrew = await badBrews()
    if (badBrew.length) {
        log(`\nThe following CLIs are installed with ${chalk.red('brew')} and shouldn't be:`)
        log(
            chalk.red(
                badBrew
                    .filter((it) => it != null)
                    .map((it) => ` - ${chalk.bold(it)}`)
                    .join('\n'),
            ),
        )
    }

    if (failedChecks.length) {
        log(`\nThe following check was not happy:`)
        log(
            chalk.red(
                failedChecks
                    .map(([cli, checkResult]) => ` - ${chalk.bold(cli)}: ${chalk.yellow(checkResult)}`)
                    .join('\n'),
            ),
        )
    } else {
        log(chalk.green(`\nEverything is OK`))
    }
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
