import * as clack from '@clack/prompts'
import chalk from 'chalk'

import { Author, createCoAuthorsText, promptForCoAuthors } from '../common/authors.ts'
import { tuiSession } from '../common/tui.ts'

type GitResult = { output: string } | { error: string }

export async function coAuthors(message: string | undefined, amend: boolean | undefined): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm mob ')), async () => {
        if (message != null) {
            await newCommitWithCoAuthors(message)
        } else if (amend) {
            await amendCommitWithCoauthors()
        } else {
            clack.log.error('You must provide a message (-m) or --amend')
            process.exitCode = 1
        }
    })
}

async function newCommitWithCoAuthors(message: string): Promise<void> {
    clack.log.info(`Creating new commit with message "${chalk.yellow(message)}"`)

    const authors = await promptForCoAuthors()
    if (authors == null) {
        clack.log.warn('Aborting, no commit was created')
        return
    }

    report(commitWithMessage(message, authors), "Commit created, don't forget to push!")
}

async function amendCommitWithCoauthors(): Promise<void> {
    const existingCommit = Bun.spawnSync(['git', 'log', '-1']).stdout.toString().trim()

    clack.note(existingCommit, 'Amending this commit with co-authors')
    clack.log.warn('Only the first line of this commit will be kept!')

    const authors = await promptForCoAuthors()
    if (authors == null) {
        clack.log.warn('Aborting, the commit was not amended')
        return
    }

    report(amendWithAuthors(authors), "Commit amended, don't forget to push with --force-with-lease (gpf)!")
}

function report(result: GitResult, successMessage: string): void {
    if ('output' in result) {
        clack.log.success(successMessage)
    } else {
        clack.log.error(`Unable to create commit:\n${chalk.gray(result.error.trim())}`)
        process.exitCode = 1
    }
}

function commitWithMessage(message: string, authors: Author[]): GitResult {
    return runGit(['git', 'commit', '-m', message, '-m', createCoAuthorsText(authors)])
}

function amendWithAuthors(authors: Author[]): GitResult {
    const existingMessageFirstLine = Bun.spawnSync(['git', 'log', '-1', '--pretty=%B'])
        .stdout.toString()
        .trim()
        .split('\n')[0]
        .trim()

    return runGit([
        'git',
        'commit',
        '--amend',
        '--no-edit',
        '-m',
        existingMessageFirstLine,
        '-m',
        createCoAuthorsText(authors),
    ])
}

function runGit(command: string[]): GitResult {
    const res = Bun.spawnSync(command)

    if (res.exitCode !== 0) {
        return { error: res.stderr.toString() }
    }

    return { output: res.stdout.toString() }
}
