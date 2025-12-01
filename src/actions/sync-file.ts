import path from 'node:path'

import * as R from 'remeda'
import chalk from 'chalk'
import { PushResult } from 'simple-git'
import { search, input, checkbox, confirm } from '@inquirer/prompts'

import { BaseRepoNode } from '../common/octokit.ts'
import { log } from '../common/log.ts'
import { getUpdatedGitterCache, Gitter } from '../common/git.ts'
import { GIT_CACHE_DIR } from '../common/cache.ts'
import { getTeam } from '../common/config.ts'
import { getAllRepos } from '../common/repos.ts'

async function cloneAllRepos(): Promise<BaseRepoNode<unknown>[]> {
    const repos = await getAllRepos(await getTeam())

    await getUpdatedGitterCache(repos)

    return repos
}

function queryRepo(query: string, repo: string): boolean {
    const result = Bun.spawnSync(query.split(' '), {
        cwd: `${GIT_CACHE_DIR}/${repo}`,
    })

    return result.exitCode === 0
}

async function getTargetRepos<Repo extends { name: string }>(otherRepos: Repo[]): Promise<Repo[]> {
    const checkboxResponse = await checkbox({
        message: 'Select repos to copy file to',
        choices: [
            { value: 'all', name: 'All repos' },
            ...otherRepos.map((it) => ({
                name: it.name,
                value: it.name,
            })),
        ],
    })

    if (checkboxResponse.includes('all')) {
        return otherRepos
    } else if (checkboxResponse.length !== 0) {
        return otherRepos.filter((it) => checkboxResponse.includes(it.name))
    } else {
        log(chalk.red('You must select at least one repo'))
        return getTargetRepos(otherRepos)
    }
}

export async function syncFileAcrossRepos(query: string): Promise<void> {
    if (!query) throw new Error('Missing query')

    const repos = await cloneAllRepos()

    const relevantRepos = R.pipe(
        repos,
        R.map((it) => [it, queryRepo(query, it.name)] as const),
        R.filter(([, result]) => result),
        R.map(([name]) => name),
    )

    log(
        `\n Welcome to ${chalk.red(
            'Interactive File Sync',
        )}! \n\n We will pick a file from one repo and copy it to other repos. \n\n The steps are: \n   1. Select source repo \n   2. Select file to sync \n   3. Select target repos \n   4. Write commit message \n   5. Confirm \n\n`,
    )

    log(`! Your query ${chalk.yellow(query)} matched ${chalk.green(relevantRepos.length)} repos:`)

    // Step 1, selecting the source repo
    const sourceRepo = await search({
        message: 'Select source repository',
        source: (term) =>
            relevantRepos
                .filter((it) => (term == null ? true : it.name.includes(term)))
                .map((it) => ({ name: it.name, value: it.name })),
    })

    // Step 2, selecting a valid file in the source repo
    const fileToSync = await getValidFileInSource(sourceRepo)

    // Step 3, selecting target repos
    const otherRepos = relevantRepos.filter((it) => it.name !== sourceRepo)
    const targetRepos = await getTargetRepos(otherRepos)

    // Step 4, writing commit message
    const commitMessage = await input({
        message: 'Commit message for sync commits',
    })

    log(`The file "${chalk.yellow(fileToSync)}" will be synced across the following repos:`)
    log(targetRepos.map((it) => ` - ${it.name}`).join('\n'))
    log(`The commit message will be "${chalk.yellow(commitMessage)}"`)

    // Step 5, confirm
    const confirmResult = await confirm({
        message: `Do you want to continue? This will create ${otherRepos.length} commits, one for each repo.`,
    })

    if (confirmResult) {
        await copyFileToRepos(sourceRepo, targetRepos, fileToSync, commitMessage)
    } else {
        log(chalk.red('Aborting!'))
    }
}

async function getValidFileInSource(sourceRepo: string, initialValue?: string): Promise<string> {
    const file = await input({
        default: initialValue,
        message: `Which file in ${sourceRepo} should be synced across? \n (Path should be root in repo)`,
    })

    const bunFile = Bun.file(path.join(GIT_CACHE_DIR, sourceRepo, file))
    log(path.join(GIT_CACHE_DIR, sourceRepo, file))
    if (await bunFile.exists()) {
        return file
    }

    log(chalk.red(`Could not find file ${file} in ${sourceRepo}`))

    return getValidFileInSource(sourceRepo, file)
}

async function copyFileToRepos(
    sourceRepo: string,
    targetRepos: { name: string; url: string }[],
    fileToSync: string,
    message: string,
): Promise<void> {
    const gitter = new Gitter('cache')
    const sourceFile = Bun.file(path.join(GIT_CACHE_DIR, sourceRepo, fileToSync))

    await Promise.all(
        targetRepos.map(async (it) => {
            log(`Copying ${chalk.yellow(`${it.name}/${fileToSync}`)} from ${chalk.yellow(sourceRepo)}`)
            const targetFile = Bun.file(path.join(GIT_CACHE_DIR, it.name, fileToSync))
            await Bun.write(targetFile, sourceFile)

            const pushResult: PushResult = await gitter
                .createRepoGitClient(it.name)
                .add(fileToSync)
                .commit(message)
                .push()

            log(`${chalk.green(`Pushed to repo ${pushResult.repo}`)} - ${it.url}`)
        }),
    )
}
