import path from 'node:path'

import chalk from 'chalk'
import { PushResult } from 'simple-git'
import { checkbox, confirm, editor, input, select } from '@inquirer/prompts'

import { getAllRepos } from '../../common/repos.ts'
import { getTeam } from '../../common/config.ts'
import { BaseRepoNode } from '../../common/octokit.ts'
import { log } from '../../common/log.ts'
import { CACHE_DIR, GIT_CACHE_DIR } from '../../common/cache.ts'
import { getUpdatedGitterCache, Gitter } from '../../common/git.ts'

const SYNC_REPLACE_STATE_FILE = path.join(CACHE_DIR, 'sync-replace-state.json')

interface SyncReplaceState {
    modifiedFiles: Record<string, string[]>
}

async function loadState(): Promise<SyncReplaceState> {
    try {
        const file = Bun.file(SYNC_REPLACE_STATE_FILE)
        if (await file.exists()) {
            return await file.json()
        }
    } catch {}
    return { modifiedFiles: {} }
}

async function saveState(state: SyncReplaceState): Promise<void> {
    await Bun.write(SYNC_REPLACE_STATE_FILE, JSON.stringify(state, null, 2))
}

async function clearState(): Promise<void> {
    await Bun.write(SYNC_REPLACE_STATE_FILE, JSON.stringify({ modifiedFiles: {} }, null, 2))
}

export async function syncReplaceReset(): Promise<void> {
    await clearState()
    log(chalk.green('Sync-replace state has been reset. No files are tracked for commit.'))
}

export async function syncReplaceMenu(): Promise<'status' | 'new' | 'reset' | 'commit'> {
    const state = await loadState()
    const trackedCount = Object.keys(state.modifiedFiles).length

    log(chalk.blue('Sync Replace\n'))
    if (trackedCount > 0) {
        log(chalk.yellow(`${trackedCount} repo(s) with tracked changes\n`))
    }
    if (trackedCount === 0) {
        const repos = await getAllRepos(await getTeam())
        await getUpdatedGitterCache(repos)
    }

    return select({
        message: 'What do you want to do?',
        choices: [
            { value: 'status' as const, name: 'Status - show tracked files' },
            { value: 'new' as const, name: 'Start new - run a new search/replace' },
            { value: 'reset' as const, name: 'Reset - clear all tracked files' },
            { value: 'commit' as const, name: 'Commit and push - commit all tracked files' },
        ],
    })
}

export async function syncReplaceInteractive(): Promise<void> {
    const startPattern = await input({ message: 'Enter start pattern:' })
    const endPatternInput = await input({ message: 'Enter end pattern (leave empty for single line match):' })
    const endPattern = endPatternInput.trim() || undefined

    const useReplacement = await confirm({
        message: 'Do you want to replace matches? (No = delete matches)',
        default: true,
    })
    let replacement: string | undefined = undefined
    if (useReplacement) {
        replacement = (await editor({ message: 'Enter replacement text (opens editor):' })).trimEnd() || undefined
    }

    const filePattern = await input({ message: 'Enter file pattern:', default: '**/*' })
    await syncReplace(startPattern, endPattern, replacement, false, filePattern)
}

export async function syncReplaceStatus(): Promise<void> {
    const state = await loadState()
    const repoNames = Object.keys(state.modifiedFiles)

    if (repoNames.length === 0) {
        log(chalk.yellow('No files are currently tracked for commit.'))
        return
    }

    log(chalk.blue('Currently tracked files for commit:\n'))
    for (const repoName of repoNames) {
        const files = state.modifiedFiles[repoName]
        log(chalk.green(`  ${repoName}:`))
        for (const file of files) {
            log(chalk.gray(`    - ${file}`))
        }
    }
    log('')
    log(chalk.gray(`Run ${chalk.yellow('tsm sync-replace commit')} to commit these changes.`))
    log(chalk.gray(`Run ${chalk.yellow('tsm sync-replace reset')} to clear tracked files.`))
}

export async function syncReplaceCommit(): Promise<void> {
    const state = await loadState()
    const repoNames = Object.keys(state.modifiedFiles)

    if (repoNames.length === 0) {
        log(chalk.yellow('No files are currently tracked for commit.'))
        return
    }

    log(chalk.blue('Files to commit:\n'))
    for (const repoName of repoNames) {
        const files = state.modifiedFiles[repoName]
        log(chalk.green(`  ${repoName}: ${files.length} file(s)`))
    }
    log('')

    const confirmResult = await confirm({
        message: `Do you want to commit and push changes to ${repoNames.length} repo(s)?`,
    })
    if (!confirmResult) {
        log(chalk.yellow('Aborted.'))
        return
    }

    const commitMessage = await input({ message: `Enter commit message:` })
    const repos = await getAllRepos(await getTeam())
    const gitter = new Gitter('cache')

    const reposWithChanges: Array<{ repoName: string; files: string[]; repo: BaseRepoNode<unknown> }> = []

    for (const repoName of repoNames) {
        const files = state.modifiedFiles[repoName]
        const repo = repos.find((r) => r.name === repoName)

        if (!repo) {
            log(chalk.red(`Repo ${repoName} not found, skipping`))
            continue
        }

        const git = gitter.createRepoGitClient(repoName)
        const diff = await git.diff()

        if (!diff) {
            log(chalk.yellow(`No changes found in ${repoName}, skipping (files may have been reset)`))
            continue
        }

        log(chalk.blue(`\n${'='.repeat(60)}`))
        log(chalk.blue(`Repository: ${repoName}`))
        log(chalk.blue(`${'='.repeat(60)}\n`))
        log(diff)

        reposWithChanges.push({ repoName, files, repo })
    }

    if (reposWithChanges.length === 0) {
        log(chalk.yellow('\nNo repos with actual changes to commit.'))
        await clearState()
        return
    }

    const confirmPush = await confirm({
        message: `\nReview complete. Push changes to ${reposWithChanges.length} repo(s)?`,
    })
    if (!confirmPush) {
        log(chalk.yellow('Aborted. Changes are still tracked locally.'))
        return
    }

    await Promise.all(
        reposWithChanges.map(async ({ repoName, files, repo }) => {
            log(`Committing and pushing ${chalk.blue(repoName)} (${files.length} file(s))`)
            const git = gitter.createRepoGitClient(repoName)

            for (const file of files) {
                await git.add(file)
            }

            const pushResult: PushResult = await git.commit(commitMessage).push()
            log(`${chalk.green(`Pushed to repo ${pushResult.repo}`)} - ${repo.url}`)
        }),
    )

    await clearState()
    log(chalk.green('\nState cleared. All tracked files have been committed.'))
}

interface MatchResult {
    file: string
    startLine: number
    endLine: number
    matchedText: string
}

interface FileChange {
    file: string
    originalContent: string
    newContent: string
    matches: MatchResult[]
}

export async function syncReplace(
    startPattern: string,
    endPattern: string | undefined,
    replacement: string | undefined,
    force: boolean,
    filePattern: string,
): Promise<void> {
    log(chalk.blue('Sync Replace'))
    log(chalk.gray(`Start pattern: ${startPattern}`))
    log(chalk.gray(`End pattern: ${endPattern ?? '(single line match)'}`))
    log(chalk.gray(`Replacement: ${replacement ?? '(delete matches)'}`))
    log(chalk.gray(`File pattern: ${filePattern}`))
    log('')

    const previousState = await loadState()
    const previouslyTrackedRepos = Object.keys(previousState.modifiedFiles)
    if (previouslyTrackedRepos.length > 0) {
        log(chalk.yellow(`Note: ${previouslyTrackedRepos.length} repo(s) have previously tracked changes.`))
        log(
            chalk.gray(
                `Run ${chalk.yellow('tsm sync-replace status')} to see them, or ${chalk.yellow('tsm sync-replace reset')} to clear.\n`,
            ),
        )
    }

    const repos = await getAllRepos(await getTeam())
    const reposWithMatches: Array<{ repo: BaseRepoNode<unknown>; changes: FileChange[] }> = []

    for (const repo of repos) {
        const changes = await findMatchesInRepo(repo.name, startPattern, endPattern, filePattern)
        if (changes.length > 0) {
            reposWithMatches.push({ repo, changes })
        }
    }

    if (reposWithMatches.length === 0) {
        log(chalk.yellow('No matches found in any repository'))
        return
    }

    log(chalk.green(`Found matches in ${reposWithMatches.length} repositories:\n`))
    reposWithMatches.forEach(({ repo, changes }) => {
        const totalMatches = changes.reduce((sum, c) => sum + c.matches.length, 0)
        log(`  ${chalk.blue(repo.name)}: ${totalMatches} match(es) in ${changes.length} file(s)`)
    })
    log('')

    const targetRepos = await selectRepos(reposWithMatches.map((r) => r.repo))
    const selectedReposWithMatches = reposWithMatches.filter((r) => targetRepos.some((t) => t.name === r.repo.name))

    if (selectedReposWithMatches.length === 0) {
        log(chalk.yellow('No repos selected'))
        return
    }

    const modifiedFiles: Record<string, Set<string>> = {}
    for (const [repoName, files] of Object.entries(previousState.modifiedFiles)) {
        modifiedFiles[repoName] = new Set(files)
    }

    for (const { repo, changes } of selectedReposWithMatches) {
        log(chalk.blue(`\n${'='.repeat(60)}`))
        log(chalk.blue(`Repository: ${repo.name}`))
        log(chalk.blue(`${'='.repeat(60)}\n`))

        displayChanges(changes, replacement)

        const shouldApply = force || (await confirmWithViewOption(repo.name, changes, replacement))

        if (shouldApply) {
            await applyChangesToRepo(repo.name, changes, replacement)
            if (!modifiedFiles[repo.name]) modifiedFiles[repo.name] = new Set()
            for (const change of changes) {
                modifiedFiles[repo.name].add(change.file)
            }
            log(chalk.green(`Changes applied to ${repo.name}`))
        } else {
            log(chalk.yellow(`Skipped ${repo.name}`))
        }
    }

    const modifiedRepoCount = Object.keys(modifiedFiles).filter((k) => modifiedFiles[k].size > 0).length
    log(chalk.blue(`\n${'='.repeat(60)}`))
    log(chalk.green(`${modifiedRepoCount} repo(s) with tracked changes`))

    if (modifiedRepoCount > 0) {
        const state: SyncReplaceState = {
            modifiedFiles: Object.fromEntries(
                Object.entries(modifiedFiles)
                    .map(([k, v]) => [k, Array.from(v)])
                    .filter(([, v]) => (v as string[]).length > 0),
            ),
        }
        await saveState(state)

        const choice = await select({
            message: 'What do you want to do?',
            choices: [
                { value: 'commit', name: 'Commit and push changes now' },
                { value: 'exit', name: 'Save and exit (run more search/replace later)' },
            ],
        })

        if (choice === 'commit') {
            await syncReplaceCommit()
        } else {
            log(chalk.yellow('\nChanges saved locally and tracked for later commit.'))
            log(chalk.gray(`Run ${chalk.yellow('tsm sync-replace')} to add more changes.`))
            log(chalk.gray(`Run ${chalk.yellow('tsm sync-replace commit')} to commit tracked files.`))
        }
    }
}

async function findMatchesInRepo(
    repoName: string,
    startPattern: string,
    endPattern: string | undefined,
    filePattern: string,
): Promise<FileChange[]> {
    const repoDir = path.join(GIT_CACHE_DIR, repoName)
    const changes: FileChange[] = []
    const glob = new Bun.Glob(filePattern)
    const files: string[] = []

    for await (const file of glob.scan({ cwd: repoDir, absolute: false, dot: true })) {
        if (!file.startsWith('.git/') && !file.includes('node_modules/')) {
            files.push(file)
        }
    }

    for (const file of files) {
        const filePath = path.join(repoDir, file)
        const bunFile = Bun.file(filePath)

        if (!(await bunFile.exists())) continue

        let content: string
        try {
            content = await bunFile.text()
        } catch {
            continue
        }

        const matches = findMatches(content, startPattern, endPattern)
        if (matches.length > 0) {
            changes.push({ file, originalContent: content, newContent: '', matches })
        }
    }

    return changes
}

function findMatches(content: string, startPattern: string, endPattern: string | undefined): MatchResult[] {
    const lines = content.split('\n')
    const matches: MatchResult[] = []

    let i = 0
    while (i < lines.length) {
        const line = lines[i]

        if (line.includes(startPattern)) {
            if (endPattern === undefined) {
                matches.push({ file: '', startLine: i + 1, endLine: i + 1, matchedText: line })
                i++
            } else {
                const startLine = i + 1
                let endLine = i + 1
                const matchedLines = [line]

                if (line.includes(endPattern) && line.indexOf(endPattern) > line.indexOf(startPattern)) {
                    matches.push({ file: '', startLine, endLine, matchedText: line })
                    i++
                    continue
                }

                let j = i + 1
                while (j < lines.length) {
                    matchedLines.push(lines[j])
                    if (lines[j].includes(endPattern)) {
                        endLine = j + 1
                        break
                    }
                    j++
                }

                if (endLine > startLine || lines[i].includes(endPattern)) {
                    matches.push({ file: '', startLine, endLine, matchedText: matchedLines.join('\n') })
                    i = j + 1
                } else {
                    i++
                }
            }
        } else {
            i++
        }
    }

    return matches
}

function applyReplacements(content: string, matches: MatchResult[], replacement: string | undefined): string {
    const lines = content.split('\n')
    const result: string[] = []
    let i = 0
    let matchIndex = 0

    while (i < lines.length) {
        if (matchIndex < matches.length && i + 1 === matches[matchIndex].startLine) {
            if (replacement !== undefined) result.push(replacement)
            i = matches[matchIndex].endLine
            matchIndex++
        } else {
            result.push(lines[i])
            i++
        }
    }

    return result.join('\n')
}

async function applyChangesToRepo(
    repoName: string,
    changes: FileChange[],
    replacement: string | undefined,
): Promise<void> {
    const repoDir = path.join(GIT_CACHE_DIR, repoName)

    for (const change of changes) {
        const filePath = path.join(repoDir, change.file)
        const newContent = applyReplacements(change.originalContent, change.matches, replacement)
        await Bun.write(filePath, newContent)
        log(chalk.gray(`  Written: ${change.file}`))
    }
}

function displayChanges(changes: FileChange[], replacement: string | undefined): void {
    for (const change of changes) {
        log(chalk.yellow(`File: ${change.file}`))
        for (const match of change.matches) {
            log(chalk.gray(`  Lines ${match.startLine}-${match.endLine}:`))
            log(chalk.red('  - ' + match.matchedText.split('\n').join('\n  - ')))
            if (replacement !== undefined) {
                log(chalk.green('  + ' + replacement.split('\n').join('\n  + ')))
            } else {
                log(chalk.gray('  (will be deleted)'))
            }
            log('')
        }
    }
}

async function confirmWithViewOption(
    repoName: string,
    changes: FileChange[],
    replacement: string | undefined,
): Promise<boolean> {
    while (true) {
        const choice = await select({
            message: `What do you want to do with ${repoName}?`,
            choices: [
                { value: 'apply', name: 'Apply changes' },
                { value: 'view', name: 'View full file(s) with diff' },
                { value: 'skip', name: 'Skip' },
            ],
        })

        if (choice === 'apply') return true
        if (choice === 'skip') return false

        for (const change of changes) {
            log(chalk.blue(`\n${'─'.repeat(60)}`))
            log(chalk.blue(`File: ${change.file}`))
            log(chalk.blue(`${'─'.repeat(60)}`))
            log(formatFileWithDiff(change.originalContent, change.matches, replacement))
            log('')
        }
    }
}

function formatFileWithDiff(content: string, matches: MatchResult[], replacement: string | undefined): string {
    const lines = content.split('\n')
    const result: string[] = []

    const matchByStartLine = new Map<number, MatchResult>()
    const matchedLineSet = new Set<number>()
    for (const match of matches) {
        matchByStartLine.set(match.startLine, match)
        for (let i = match.startLine; i <= match.endLine; i++) matchedLineSet.add(i)
    }

    let lineNum = 1
    for (let i = 0; i < lines.length; i++) {
        const lineNumber = i + 1
        const lineNumStr = lineNum.toString().padStart(4, ' ')

        if (matchByStartLine.has(lineNumber)) {
            const match = matchByStartLine.get(lineNumber)!
            for (let j = match.startLine; j <= match.endLine; j++) {
                result.push(chalk.red(`   - │ ${lines[j - 1]}`))
            }
            if (replacement !== undefined) {
                for (const repLine of replacement.split('\n')) {
                    result.push(chalk.green(`   + │ ${repLine}`))
                }
            }
            i = match.endLine - 1
            lineNum++
        } else if (!matchedLineSet.has(lineNumber)) {
            result.push(chalk.gray(`${lineNumStr} │`) + ` ${lines[i]}`)
            lineNum++
        }
    }

    return result.join('\n')
}

async function selectRepos<Repo extends { name: string }>(repos: Repo[]): Promise<Repo[]> {
    const response = await checkbox({
        message: 'Select repos to apply changes to',
        choices: [{ value: 'all', name: 'All repos' }, ...repos.map((it) => ({ name: it.name, value: it.name }))],
    })

    if (response.includes('all')) return repos
    if (response.length !== 0) return repos.filter((it) => response.includes(it.name))

    log(chalk.red('You must select at least one repo'))
    return selectRepos(repos)
}
