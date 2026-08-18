import chalk from 'chalk'
import path from 'node:path'

import { GIT_CACHE_DIR } from '../../common/cache.ts'
import { getTeam } from '../../common/config.ts'
import { getUpdatedGitterCache } from '../../common/git.ts'
import { log } from '../../common/log.ts'
import { getAllRepos } from '../../common/repos.ts'

const EXPECTED_VERSION_VARIABLE = 'tsmKtorVersion'
const TSM_KTOR_REGEX = /no\.nav\.tsm:ktor[^:]*:\$\{?(\w+)}?/

export async function ktor(): Promise<void> {
    const repos = await getAllRepos(await getTeam())
    await getUpdatedGitterCache(repos)

    const hits = await Promise.all(
        repos.map(async (repo) => {
            const settingsFile = Bun.file(path.join(GIT_CACHE_DIR, repo.name, 'settings.gradle.kts'))
            if (!(await settingsFile.exists())) return null

            const content = await settingsFile.text()
            if (!content.includes('no.nav.tsm:ktor')) return null

            const variable = content.match(TSM_KTOR_REGEX)?.[1] ?? null
            const version =
                variable != null
                    ? (content.match(new RegExp(`val\\s+${variable}\\s*=\\s*"([^"]+)"`))?.[1] ?? null)
                    : null

            return [repo.name, variable, version] as const
        }),
    )

    hits.filter((it) => it != null).forEach(([name, variable, version]) => {
        if (variable !== EXPECTED_VERSION_VARIABLE) {
            log(`${chalk.red('✗')} ${name}: ${chalk.red(variable ?? 'no version variable')}`)
        } else if (version == null) {
            log(`${chalk.red('✗')} ${name}: ${chalk.red(`${variable} not declared in settings.gradle.kts`)}`)
        } else {
            log(`${chalk.green('✓')} ${name}: ${chalk.white(version)}`)
        }
    })
}
