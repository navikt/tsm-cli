import * as path from 'node:path'
import * as fs from 'node:fs'

import * as R from 'remeda'
import { parse } from 'semver'
import chalk from 'chalk'

import packageJson from '../../tsm-cli/package.json'
import { log, logError } from '../common/log.ts'
import { CACHE_DIR } from '../common/cache.ts'
import { getOctokitClient } from '../common/octokit.ts'

export async function hasNewVersion(): Promise<string | null> {
    const response = await getOctokitClient('package').request(
        'GET /orgs/{owner}/packages/{package_type}/{package_name}/versions',
        {
            owner: 'navikt',
            package_type: 'npm',
            package_name: 'teamsykmelding-cli',
        },
    )

    const version =
        R.pipe(
            response.data,
            R.sortBy([(it: { name: string; updated_at: string }) => it.updated_at, 'desc']),
            R.map((it) => it.name),
            R.first(),
        ) ?? null

    if (!parse(version)) {
        throw new Error(`Could not parse version ${version}`)
    }

    return version !== packageJson.version ? version : null
}

export async function updateToNewestVersion(): Promise<void> {
    const newVersion = await hasNewVersion()
    if (newVersion != null) {
        log(`Updating to ${chalk.green(newVersion)}...`)
        const updateSub = Bun.spawnSync('npm i -g @navikt/teamsykmelding-cli'.split(' '))
        if (updateSub.exitCode === 0) {
            log(chalk.green(`Updated to version ${newVersion}!`))
            reportChangesSinceLast(packageJson.version)
        } else {
            log(chalk.bgWhite.red(`Could not update to version ${newVersion}.`))
            log(chalk.red(updateSub.stderr.toString()))

            process.exit(1)
        }
        const metadataPath = path.join(CACHE_DIR, 'metadata.json')
        if (await Bun.file(metadataPath).exists()) {
            fs.rmSync(metadataPath)
        }
    } else {
        log(chalk.green(`You are on the latest version!`))
    }
}

export async function reportChangesSinceLast(existingVersion: string | null): Promise<void> {
    type GithubResponse = { sha: string; commit: { author: { name: string }; message: string } }[]

    const response = await getOctokitClient('cli').request('GET /repos/{owner}/{repo}/commits', {
        owner: 'navikt',
        repo: 'teamsykmelding-cli',
    })

    if (response.status !== 200) {
        logError(`Unable to fetch latest commits from github: ${response.status}`)
        return
    }

    const changes = R.pipe(
        response.data as GithubResponse,
        R.map(({ commit: { author, message } }) => [author.name, message.split('\n')[0]]),
        (commits) => {
            if (existingVersion == null) return commits

            const versions = commits.filter(([, message]) => message.includes('bump version'))
            const previousVersionIndex = versions.findIndex(([, message]) => message.includes(existingVersion))
            const relevantVersion = versions[previousVersionIndex > 0 ? previousVersionIndex - 1 : 0]

            return R.pipe(
                commits,
                R.splitWhen(([, message]) => message === relevantVersion[1]),
                R.first(),
            )
        },
        R.filter(([, message]) => !message.includes('bump version')),
    )

    if (changes && changes.length > 0) {
        if (existingVersion == null) {
            log(chalk.green(`Latest changes in tsm:\n`))
        } else {
            log(chalk.green(`\nChanges since last version (${packageJson.version}):`))
        }
        changes.forEach(([author, message]) =>
            log(chalk.yellowBright(`${message}\n\t${chalk.blueBright(`by ${author}`)}`)),
        )
    }
}

export async function hasNewVersionCached(): Promise<string | null> {
    const versionFile = Bun.file(path.join(CACHE_DIR, 'metadata.json'))
    if (!(await versionFile.exists())) return null

    const file = await versionFile.json()
    return file?.newVersion !== packageJson.version ? file.newVersion : null
}

export async function writeNewVersionCache(version: string | null): Promise<void> {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    await Bun.write(path.join(CACHE_DIR, 'metadata.json'), JSON.stringify({ newVersion: version }))
}

if (Bun.argv.find((it) => it.includes('self-updater.ts'))) {
    const newVersion = await hasNewVersion()
    if (newVersion != null) {
        await writeNewVersionCache(newVersion)
    } else {
        await writeNewVersionCache(null)
    }
}
