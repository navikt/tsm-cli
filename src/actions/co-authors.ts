import chalk from 'chalk'

import { Author, createCoAuthorsText, promptForCoAuthors } from '../common/authors.ts'
import { log, logError } from '../common/log.ts'

export async function coAuthors(message: string | undefined, amend: boolean | undefined): Promise<void> {
    if (message == null && amend == null) {
        logError(chalk.red('You must provide a message (-m) or --amend'))
        process.exit(1)
    }

    if (message != null) {
        await newCommitWithCoAuthors(message)
        return
    }

    if (amend) {
        await amendCommitWithCoauthors()
        return
    }

    logError(chalk.red('Illegal state: You must provide a message (-m) or --amend'))
    process.exit(1)
}

async function newCommitWithCoAuthors(message: string): Promise<void> {
    log(`Creating new commit with message "${message}", who is co-authoring this?\n`)

    const authors = await promptForCoAuthors()
    const result = commitWithMessage(message, authors)

    if ('output' in result) {
        log(chalk.green("Commit created, don't forget to push!"))
    } else {
        logError(chalk.red('Unable to create commit: '))
        logError(result.error)
    }
}

async function amendCommitWithCoauthors(): Promise<void> {
    const existingCommit = Bun.spawnSync(['git', 'log', '-1']).stdout.toString().trim()

    log(`${chalk.green('Amending the following commit with Co-Authors:')}\n`)
    log(chalk.yellow(existingCommit))
    log(chalk.cyan.bold('\nOnly the first line of this commit will be kept!!!\n'))
    log(chalk.green('Who is co-authoring this?\n'))

    const authors = await promptForCoAuthors()
    const result = amendWithAuthors(authors)
    if ('output' in result) {
        log(chalk.green("Commit amended, don't forget to push with --force-with-lease (gpf)!"))
    } else {
        logError(chalk.red('Unable to create commit: '))
        logError(result.error)
    }
}

function commitWithMessage(message: string, authors: Author[]): { output: string } | { error: string } {
    const command = ['git', 'commit', '-m', message, '-m', createCoAuthorsText(authors)]

    const res = Bun.spawnSync(command)
    const stdout = res.stdout.toString()
    const stderr = res.stderr.toString()

    if (res.exitCode !== 0) {
        return { error: stderr }
    } else {
        return { output: stdout }
    }
}

function amendWithAuthors(authors: Author[]): { output: string } | { error: string } {
    const existingMessageFirstLine = Bun.spawnSync(['git', 'log', '-1', '--pretty=%B'])
        .stdout.toString()
        .trim()
        .split('\n')[0]
        .trim()

    const command = [
        'git',
        'commit',
        '--amend',
        '--no-edit',
        '-m',
        existingMessageFirstLine,
        '-m',
        createCoAuthorsText(authors),
    ]

    const res = Bun.spawnSync(command)
    const stdout = res.stdout.toString()
    const stderr = res.stderr.toString()

    if (res.exitCode !== 0) {
        return { error: stderr }
    } else {
        return { output: stdout }
    }
}
