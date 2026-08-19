import chalk from 'chalk'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { log, logError } from '../common/log.ts'

type Shell = 'zsh' | 'bash'

type Target = { file: string; fpathLine?: string }

/**
 * Prints the completion script, or writes it to where the user's shell will pick it up.
 */
export async function completion(install: boolean, script: string): Promise<void> {
    if (!install) {
        log(script)
        return
    }

    const shell = currentShell()

    if (shell == null) {
        logError(
            `Unable to figure out your shell from ${chalk.yellow('$SHELL')} (${process.env.SHELL ?? 'unset'}), only ${chalk.green('zsh')} and ${chalk.green('bash')} are supported.`,
        )
        return
    }

    const target: Target = shell === 'zsh' ? await zshTarget() : bashTarget()

    await Bun.write(target.file, script)

    log(`${chalk.green('✓')} Wrote ${shell} completions to ${chalk.yellow(prettyPath(target.file))}`)

    if (target.fpathLine != null) {
        log('')
        log(`Found no writable directory in your ${chalk.yellow('$fpath')}, so add this to ${chalk.yellow('~/.zshrc')}`)
        log(`${chalk.gray('(before')} ${chalk.yellow('compinit')} ${chalk.gray('runs):')}`)
        log('')
        log(`\t${chalk.green(target.fpathLine)}`)
    }

    log('')
    log(`Start a new shell to use it, then try ${chalk.cyan('tsm gr')}${chalk.gray('<TAB>')}`)
}

function currentShell(): Shell | null {
    const shell = path.basename(process.env.SHELL ?? '')

    return shell === 'zsh' || shell === 'bash' ? shell : null
}

/** Names of `$fpath` entries that are meant to hold user completions. */
const COMPLETION_DIR = /(?:^|\/)(?:completions|site-functions)$/

/**
 * Zsh loads completions from files named `_<command>` in any directory in `$fpath`, so prefer a
 * directory that's already there. If there is none we can write to, fall back to our own config
 * directory and tell the user to add it themselves.
 */
async function zshTarget(): Promise<Target> {
    const candidates = (await zshFpath())
        // Plugin and function directories are also in $fpath, we only want completion directories
        .filter((it) => COMPLETION_DIR.test(it) && !it.includes(`${path.sep}cache${path.sep}`))
        // A `custom` directory survives updates of whatever put it in $fpath, so prefer those
        .sort(
            (a, b) =>
                Number(b.includes(`${path.sep}custom${path.sep}`)) - Number(a.includes(`${path.sep}custom${path.sep}`)),
        )

    // Frameworks like oh-my-zsh put directories in $fpath without necessarily creating them
    const dir = candidates.find(isOwnWritableDirectory) ?? candidates.find(isOwnCreatableDirectory)

    if (dir != null) {
        fs.mkdirSync(dir, { recursive: true })

        return { file: path.join(dir, '_tsm') }
    }

    const fallback = path.join(configHome(), 'tsm', 'completions')

    fs.mkdirSync(fallback, { recursive: true })

    return { file: path.join(fallback, '_tsm'), fpathLine: `fpath=(${prettyPath(fallback)} $fpath)` }
}

/**
 * Bash-completion loads completions on demand from a file named after the command, so no rc
 * changes are needed.
 */
function bashTarget(): Target {
    const dir = path.join(dataHome(), 'bash-completion', 'completions')

    fs.mkdirSync(dir, { recursive: true })

    return { file: path.join(dir, 'tsm') }
}

/**
 * Asks the user's interactive zsh for its `$fpath`, so we also see directories their .zshrc adds,
 * such as the oh-my-zsh and Homebrew ones.
 */
async function zshFpath(): Promise<string[]> {
    const proc = Bun.spawn(['zsh', '-ic', 'print -l -- $fpath'], { stdout: 'pipe', stderr: 'ignore' })
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])

    if (exitCode !== 0) return []

    return stdout
        .split('\n')
        .map((it) => it.trim())
        .filter((it) => it.length > 0)
}

/**
 * Only write to directories the user owns, we're not messing with system or package manager
 * directories that happen to be writable.
 */
function isOwnWritableDirectory(dir: string): boolean {
    if (!dir.startsWith(`${homeDir()}${path.sep}`)) return false

    try {
        fs.accessSync(dir, fs.constants.W_OK)

        return fs.statSync(dir).isDirectory()
    } catch {
        return false
    }
}

/** A directory we could create, i.e. one that doesn't exist but has an existing writable parent. */
function isOwnCreatableDirectory(dir: string): boolean {
    return !fs.existsSync(dir) && isOwnWritableDirectory(path.dirname(dir))
}

function homeDir(): string {
    return process.env.HOME ?? os.homedir()
}

function configHome(): string {
    return process.env.XDG_CONFIG_HOME ?? path.join(homeDir(), '.config')
}

function dataHome(): string {
    return process.env.XDG_DATA_HOME ?? path.join(homeDir(), '.local', 'share')
}

function prettyPath(value: string): string {
    return value.startsWith(homeDir()) ? value.replace(homeDir(), '~') : value
}
