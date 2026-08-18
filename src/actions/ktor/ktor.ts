import * as clack from '@clack/prompts'
import chalk from 'chalk'
import path from 'node:path'

import { GIT_CACHE_DIR } from '../../common/cache.ts'
import { getTeam } from '../../common/config.ts'
import { getGitterCache } from '../../common/git.ts'
import { getAllRepos } from '../../common/repos.ts'
import { tuiSession, withSpinner } from '../../common/tui.ts'

const EXPECTED_VERSION_VARIABLE = 'tsmKtorVersion'
const TSM_KTOR_REGEX = /no\.nav\.tsm:ktor[^:]*:\$\{?(\w+)}?/

type KtorRepo = {
    name: string
    variable: string | null
    version: string | null
}

export async function ktor(): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm ktor ')), async () => {
        const team = await getTeam()

        const repos = await withSpinner(
            `Fetching repos for ${team}`,
            () => getAllRepos(team),
            (repos) => `Found ${chalk.yellow(repos.length)} repos in ${chalk.yellow(team)}`,
        )

        await withSpinner(
            'Updating local git cache',
            async (spinner) => {
                const gitter = getGitterCache()
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

        const ktorRepos = await withSpinner(
            'Looking for no.nav.tsm:ktor',
            async () => (await Promise.all(repos.map((repo) => checkRepo(repo.name)))).filter((it) => it != null),
            (hits) => `Found ${chalk.yellow(hits.length)} repos using no.nav.tsm:ktor`,
        )

        clack.note(ktorRepos.map(toResultLine).join('\n'), 'tsm ktor versions')
    })
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

async function checkRepo(name: string): Promise<KtorRepo | null> {
    const settingsFile = Bun.file(path.join(GIT_CACHE_DIR, name, 'settings.gradle.kts'))
    if (!(await settingsFile.exists())) return null

    const content = await settingsFile.text()
    if (!content.includes('no.nav.tsm:ktor')) return null

    const variable = content.match(TSM_KTOR_REGEX)?.[1] ?? null
    const version =
        variable != null ? (content.match(new RegExp(`val\\s+${variable}\\s*=\\s*"([^"]+)"`))?.[1] ?? null) : null

    return { name, variable, version }
}
