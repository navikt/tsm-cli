import chalk from 'chalk'
import { semver } from 'bun'

import packageJson from '../tsm-cli/package.json'

import { hasNewVersionCached } from './updater/self-updater.ts'
import { log } from './common/log.ts'
import { getYargsParser } from './yargs-parser.ts'
import { isTeamConfigured } from './common/config.ts'
import { tsmx } from './tsmx.ts'
import { checkForNewVersion } from './updater/self-checker.ts'

if (Bun.argv.length >= 3 && Bun.argv[2].endsWith('tsmx')) {
    await tsmx()
    process.exit(0)
}

if (
    Bun.argv.find((it) => it.includes('update')) == null &&
    // when sanity checking bundle, don't look for new updates
    !Bun.argv[1].includes('tsm-cli/bin')
) {
    // Only spawn a background version check all other args, or else we get a infinite loop of spawns
    checkForNewVersion(true)

    const isUpgradeCommand = Bun.argv.find((it) => it === 'upgrade') != null
    if (!isUpgradeCommand) {
        // Check cache and notify if there is a new version
        const newVersion = await hasNewVersionCached()
        if (newVersion) {
            log(
                `\n\tNew version available! ${chalk.yellow(packageJson.version)} -> ${chalk.green(
                    newVersion,
                )}\n\n\tRun ${chalk.cyan('tsm upgrade')} to upgrade\n`,
            )
        }
    }
}

if (!semver || !semver.satisfies(Bun.version, '>= 1.2.0')) {
    log(chalk.red('Oh no!!!!!'))
    log(`This version of ${chalk.blue('tsm')} requires at least ${chalk.green('bun')} version ${chalk.green('1.0.25')}`)
    log(`Please run ${chalk.green('bun upgrade')} to upgrade`)
    process.exit(1)
}

if (!(await isTeamConfigured()) && !Bun.argv.includes('config')) {
    log(chalk.red('No team configured, please run:'))
    log(chalk.green('tsm config --team=<team-name>'))
    process.exit(1)
}

await getYargsParser(process.argv).demandCommand().strict().parse()
