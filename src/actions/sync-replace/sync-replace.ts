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
const CONTEXT_LINES = 10

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

export async function syncReplaceMenu(): Promise<
    'status' | 'new' | 'reset' | 'commit' | 'review' | 'vscode' | 'rediff'
> {
    const state = await loadState()
    const trackedCount = Object.keys(state.modifiedFiles).length
    const totalFiles = Object.values(state.modifiedFiles).reduce((sum, files) => sum + files.length, 0)

    log(chalk.blue('Sync Replace\n'))
    if (trackedCount > 0) {
        log(chalk.yellow(`${trackedCount} repo(s) with ${totalFiles} tracked file(s)\n`))
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
            ...(trackedCount > 0
                ? [{ value: 'review' as const, name: 'Review - go through each file, keep or undo' }]
                : []),
            ...(trackedCount > 0
                ? [{ value: 'rediff' as const, name: 'Rediff - find and add new changes from tracked repos' }]
                : []),
            ...(trackedCount > 0
                ? [{ value: 'vscode' as const, name: 'Open in VS Code - open all tracked repos' }]
                : []),
            { value: 'reset' as const, name: 'Reset - clear all tracked files' },
            { value: 'commit' as const, name: 'Commit and push - commit all tracked files' },
        ],
    })
}

export async function syncReplaceInteractive(): Promise<void> {
    const startPattern = await input({ message: 'Enter start pattern:' })
    const endPatternInput = await input({ message: 'Enter end pattern (leave empty for single line match):' })
    const endPattern = endPatternInput.trim() || undefined

    let excludeStart = false
    let excludeEnd = false
    if (endPattern) {
        const excludeChoices = await checkbox({
            message: 'Exclude boundaries from replacement?',
            choices: [
                { value: 'start', name: 'Exclude start line (keep line matching start pattern)' },
                { value: 'end', name: 'Exclude end line (keep line matching end pattern)' },
            ],
        })
        excludeStart = excludeChoices.includes('start')
        excludeEnd = excludeChoices.includes('end')
    }

    const useReplacement = await confirm({
        message: 'Do you want to replace matches? (No = delete matches)',
        default: true,
    })
    let replacement: string | undefined = undefined
    if (useReplacement) {
        replacement = (await editor({ message: 'Enter replacement text (opens editor):' })).trimEnd() || undefined
    }

    const filePattern = await input({ message: 'Enter file pattern:', default: '**/*' })
    const repoType = await select({
        message: 'Filter repos by type:',
        choices: [
            { value: 'all', name: 'All repos' },
            { value: 'jvm', name: 'JVM repos (Gradle/Kotlin/Java)' },
            { value: 'node', name: 'Node repos (package.json)' },
        ],
    })
    await syncReplace(
        startPattern,
        endPattern,
        replacement,
        false,
        filePattern,
        repoType as RepoType,
        excludeStart,
        excludeEnd,
    )
}

type RepoType = 'all' | 'jvm' | 'node'

async function isRepoOfType(repoName: string, repoType: RepoType): Promise<boolean> {
    if (repoType === 'all') return true

    const repoDir = path.join(GIT_CACHE_DIR, repoName)

    if (repoType === 'jvm') {
        const gradleFile = Bun.file(path.join(repoDir, 'build.gradle.kts'))
        const gradleFileGroovy = Bun.file(path.join(repoDir, 'build.gradle'))
        const pomFile = Bun.file(path.join(repoDir, 'pom.xml'))
        return (await gradleFile.exists()) || (await gradleFileGroovy.exists()) || (await pomFile.exists())
    }

    if (repoType === 'node') {
        const packageJson = Bun.file(path.join(repoDir, 'package.json'))
        return await packageJson.exists()
    }

    return true
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

export async function syncReplaceRediff(): Promise<void> {
    const state = await loadState()
    const repoNames = Object.keys(state.modifiedFiles)

    if (repoNames.length === 0) {
        log(chalk.yellow('No repos are currently tracked.'))
        return
    }

    const gitter = new Gitter('cache')
    const updatedModifiedFiles: Record<string, string[]> = { ...state.modifiedFiles }
    let newFilesFound = 0

    for (const repoName of repoNames) {
        const git = gitter.createRepoGitClient(repoName)
        const trackedFiles = new Set(state.modifiedFiles[repoName])

        const diffSummary = await git.diffSummary()
        const allChangedFiles = diffSummary.files.map((f) => f.file)
        const newFiles = allChangedFiles.filter((f) => !trackedFiles.has(f))

        if (newFiles.length === 0) continue

        log(chalk.blue(`\n${repoName}: ${newFiles.length} new changed file(s)\n`))

        for (const file of newFiles) {
            newFilesFound++
            log(chalk.blue(`${'='.repeat(60)}`))
            log(chalk.blue(`${repoName} - ${file}`))
            log(chalk.blue(`${'='.repeat(60)}\n`))

            try {
                const diff = await git.diff([file])
                if (diff) {
                    displayDiff(diff)
                }
            } catch {
                log(chalk.yellow('Could not get diff for this file'))
            }

            const shouldAdd = await confirm({
                message: 'Add this file to tracked changes?',
                default: true,
            })

            if (shouldAdd) {
                if (!updatedModifiedFiles[repoName]) {
                    updatedModifiedFiles[repoName] = []
                }
                updatedModifiedFiles[repoName].push(file)
                log(chalk.green('Added to tracked files'))
            } else {
                log(chalk.yellow('Skipped'))
            }
        }
    }

    await saveState({ modifiedFiles: updatedModifiedFiles })

    if (newFilesFound === 0) {
        log(chalk.yellow('\nNo new changes found in tracked repos.'))
    } else {
        const totalFiles = Object.values(updatedModifiedFiles).reduce((sum, files) => sum + files.length, 0)
        log(chalk.blue(`\n${'='.repeat(60)}`))
        log(
            chalk.green(
                `Done. Now tracking ${totalFiles} file(s) in ${Object.keys(updatedModifiedFiles).length} repo(s).`,
            ),
        )
    }
}

export async function syncReplaceOpenVscode(): Promise<void> {
    const state = await loadState()
    const repoNames = Object.keys(state.modifiedFiles)

    if (repoNames.length === 0) {
        log(chalk.yellow('No repos are currently tracked.'))
        return
    }

    const repoPaths = repoNames.map((repoName) => path.join(GIT_CACHE_DIR, repoName))

    log(chalk.blue(`Opening ${repoNames.length} repo(s) in VS Code...\n`))

    const proc = Bun.spawn(['code', ...repoPaths], {
        stdout: 'inherit',
        stderr: 'inherit',
    })
    await proc.exited

    log(chalk.green('Done'))
}

export async function syncReplaceReview(): Promise<void> {
    const state = await loadState()
    const repoNames = Object.keys(state.modifiedFiles)

    if (repoNames.length === 0) {
        log(chalk.yellow('No files are currently tracked for review.'))
        return
    }

    const totalFiles = Object.values(state.modifiedFiles).reduce((sum, files) => sum + files.length, 0)
    log(chalk.blue(`Reviewing ${totalFiles} file(s) in ${repoNames.length} repo(s)\n`))

    const gitter = new Gitter('cache')
    const updatedModifiedFiles: Record<string, string[]> = {}
    let fileNumber = 0

    for (const repoName of repoNames) {
        const files = state.modifiedFiles[repoName]
        const git = gitter.createRepoGitClient(repoName)
        const keptFiles: string[] = []

        for (const file of files) {
            fileNumber++
            log(chalk.blue(`\n${'='.repeat(60)}`))
            log(chalk.blue(`[${fileNumber}/${totalFiles}] ${repoName} - ${file}`))
            log(chalk.blue(`${'='.repeat(60)}\n`))

            try {
                const diff = await git.diff([file])
                if (!diff) {
                    log(chalk.yellow('No changes in this file (already reset or unchanged)'))
                    continue
                }
                displayDiff(diff)
            } catch {
                log(chalk.yellow('Could not get diff for this file'))
                continue
            }

            const choice = await select({
                message: 'What do you want to do with this file?',
                choices: [
                    { value: 'keep', name: 'Keep changes' },
                    { value: 'undo', name: 'Undo changes (restore original)' },
                ],
            })

            if (choice === 'keep') {
                keptFiles.push(file)
                log(chalk.green('Keeping changes'))
            } else {
                await git.checkout([file])
                log(chalk.yellow('Changes undone'))
            }
        }

        if (keptFiles.length > 0) {
            updatedModifiedFiles[repoName] = keptFiles
        }
    }

    await saveState({ modifiedFiles: updatedModifiedFiles })

    const keptRepos = Object.keys(updatedModifiedFiles).length
    const keptFilesCount = Object.values(updatedModifiedFiles).reduce((sum, files) => sum + files.length, 0)
    log(chalk.blue(`\n${'='.repeat(60)}`))
    if (keptFilesCount > 0) {
        log(chalk.green(`Review complete. ${keptFilesCount} file(s) in ${keptRepos} repo(s) kept.`))
        log(chalk.gray(`Run ${chalk.yellow('tsm sync-replace commit')} to commit these changes.`))
    } else {
        log(chalk.yellow('All changes have been undone. No files tracked.'))
    }
}

function displayDiff(diff: string): void {
    const lines = diff.split('\n')
    for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
            log(chalk.green(line))
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            log(chalk.red(line))
        } else if (line.startsWith('@@')) {
            log(chalk.cyan(line))
        } else {
            log(chalk.gray(line))
        }
    }
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

    const successfulRepos: string[] = []
    const failedRepos: string[] = []

    await Promise.all(
        reposWithChanges.map(async ({ repoName, files, repo }) => {
            log(`Committing and pushing ${chalk.blue(repoName)} (${files.length} file(s))`)
            const git = gitter.createRepoGitClient(repoName)

            try {
                for (const file of files) {
                    await git.add(file)
                }

                const pushResult: PushResult = await git.commit(commitMessage).push()
                log(`${chalk.green(`Pushed to repo ${pushResult.repo}`)} - ${repo.url}`)
                successfulRepos.push(repoName)
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error)
                log(chalk.red(`Error pushing ${repoName}: ${errorMessage}`))
                failedRepos.push(repoName)
            }
        }),
    )

    const updatedModifiedFiles: Record<string, string[]> = {}
    for (const repoName of failedRepos) {
        if (state.modifiedFiles[repoName]) {
            updatedModifiedFiles[repoName] = state.modifiedFiles[repoName]
        }
    }
    await saveState({ modifiedFiles: updatedModifiedFiles })

    if (successfulRepos.length > 0) {
        log(chalk.green(`\nSuccessfully pushed ${successfulRepos.length} repo(s).`))
    }
    if (failedRepos.length > 0) {
        log(chalk.red(`\nFailed to push ${failedRepos.length} repo(s). They remain tracked in state.`))
        log(chalk.gray(`Run ${chalk.yellow('tsm sync-replace commit')} to retry.`))
    } else {
        log(chalk.green('State cleared. All tracked files have been committed.'))
    }
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
    matches: MatchResult[]
}

export async function syncReplace(
    startPattern: string,
    endPattern: string | undefined,
    replacement: string | undefined,
    force: boolean,
    filePattern: string,
    repoType: RepoType = 'all',
    excludeStart: boolean = false,
    excludeEnd: boolean = false,
): Promise<void> {
    log(chalk.blue('Sync Replace'))
    log(chalk.gray(`Start pattern: ${startPattern}`))
    log(chalk.gray(`End pattern: ${endPattern ?? '(single line match)'}`))
    if (endPattern && (excludeStart || excludeEnd)) {
        log(chalk.gray(`Exclude: ${[excludeStart && 'start', excludeEnd && 'end'].filter(Boolean).join(', ')}`))
    }
    log(chalk.gray(`Replacement: ${replacement ?? '(delete matches)'}`))
    log(chalk.gray(`File pattern: ${filePattern}`))
    log(chalk.gray(`Repo type: ${repoType}`))
    log('')

    const previousState = await loadState()
    const previouslyTrackedRepos = Object.keys(previousState.modifiedFiles)

    let searchOnlyTracked = false
    if (previouslyTrackedRepos.length > 0) {
        log(chalk.yellow(`Active session: ${previouslyTrackedRepos.length} repo(s) with tracked changes.\n`))
        searchOnlyTracked = await confirm({
            message: 'Search only in tracked repos?',
            default: true,
        })
    }

    let repos: BaseRepoNode<unknown>[]
    if (searchOnlyTracked) {
        repos = previouslyTrackedRepos.map((name) => ({ name, url: '' }) as BaseRepoNode<unknown>)
        log(chalk.gray(`Searching in ${repos.length} tracked repo(s)...\n`))
    } else {
        repos = await getAllRepos(await getTeam())
    }

    const reposWithMatches: Array<{ repo: BaseRepoNode<unknown>; changes: FileChange[] }> = []

    for (const repo of repos) {
        if (!(await isRepoOfType(repo.name, repoType))) continue
        const changes = await findMatchesInRepo(repo.name, startPattern, endPattern, filePattern)
        if (changes.length > 0) {
            reposWithMatches.push({ repo, changes })
        }
    }

    if (reposWithMatches.length === 0) {
        log(chalk.yellow('No matches found in any repository'))
        return
    }

    const totalMatches = reposWithMatches.reduce(
        (sum, { changes }) => sum + changes.reduce((s, c) => s + c.matches.length, 0),
        0,
    )
    log(chalk.green(`Found ${totalMatches} match(es) in ${reposWithMatches.length} repositories:\n`))
    reposWithMatches.forEach(({ repo, changes }) => {
        const matchCount = changes.reduce((sum, c) => sum + c.matches.length, 0)
        log(`  ${chalk.blue(repo.name)}: ${matchCount} match(es) in ${changes.length} file(s)`)
    })
    log('')

    const targetRepos = await selectRepos(
        reposWithMatches.map((r) => r.repo),
        previouslyTrackedRepos,
    )
    const selectedReposWithMatches = reposWithMatches.filter((r) => targetRepos.some((t) => t.name === r.repo.name))

    if (selectedReposWithMatches.length === 0) {
        log(chalk.yellow('No repos selected'))
        return
    }

    const modifiedFiles: Record<string, Set<string>> = {}
    for (const [repoName, files] of Object.entries(previousState.modifiedFiles)) {
        modifiedFiles[repoName] = new Set(files)
    }

    let matchNumber = 0
    const selectedMatchCount = selectedReposWithMatches.reduce(
        (sum, { changes }) => sum + changes.reduce((s, c) => s + c.matches.length, 0),
        0,
    )

    for (const { repo, changes } of selectedReposWithMatches) {
        const approvedMatchesByFile: Map<string, MatchResult[]> = new Map()

        for (const change of changes) {
            for (const match of change.matches) {
                matchNumber++
                log(chalk.blue(`\n${'='.repeat(60)}`))
                log(chalk.blue(`[${matchNumber}/${selectedMatchCount}] ${repo.name} - ${change.file}`))
                log(chalk.blue(`${'='.repeat(60)}\n`))

                displayMatchWithContext(change.originalContent, match, replacement, excludeStart, excludeEnd)

                const shouldApply =
                    force ||
                    (await confirm({
                        message: 'Apply this change?',
                        default: true,
                    }))

                if (shouldApply) {
                    if (!approvedMatchesByFile.has(change.file)) {
                        approvedMatchesByFile.set(change.file, [])
                    }
                    approvedMatchesByFile.get(change.file)!.push(match)
                    log(chalk.green('Approved'))
                } else {
                    log(chalk.yellow('Skipped'))
                }
            }
        }

        if (approvedMatchesByFile.size > 0) {
            await applyApprovedChanges(repo.name, changes, approvedMatchesByFile, replacement, excludeStart, excludeEnd)
            if (!modifiedFiles[repo.name]) modifiedFiles[repo.name] = new Set()
            for (const file of approvedMatchesByFile.keys()) {
                modifiedFiles[repo.name].add(file)
            }
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

function displayMatchWithContext(
    content: string,
    match: MatchResult,
    replacement: string | undefined,
    excludeStart: boolean = false,
    excludeEnd: boolean = false,
): void {
    const lines = content.split('\n')
    const startContext = Math.max(0, match.startLine - 1 - CONTEXT_LINES)
    const endContext = Math.min(lines.length - 1, match.endLine - 1 + CONTEXT_LINES)

    const effectiveStartLine = excludeStart ? match.startLine + 1 : match.startLine
    const effectiveEndLine = excludeEnd ? match.endLine - 1 : match.endLine

    for (let i = startContext; i <= endContext; i++) {
        const lineNum = (i + 1).toString().padStart(4, ' ')
        const lineNumber = i + 1
        const isExcludedBoundary =
            (excludeStart && lineNumber === match.startLine) || (excludeEnd && lineNumber === match.endLine)
        const isMatchLine = lineNumber >= effectiveStartLine && lineNumber <= effectiveEndLine

        if (isExcludedBoundary) {
            log(chalk.yellow(`${lineNum} ~ │ ${lines[i]}`))
        } else if (isMatchLine) {
            log(chalk.red(`${lineNum} - │ ${lines[i]}`))
        } else {
            log(chalk.gray(`${lineNum}   │ ${lines[i]}`))
        }
    }

    if (replacement !== undefined) {
        const indentSourceLine = excludeStart ? match.startLine : match.startLine - 1
        const originalIndent = getIndentation(lines[Math.max(0, indentSourceLine)])
        const indentedReplacement = applyIndentation(replacement, originalIndent)
        log(chalk.green(`\n     + │ ${indentedReplacement.split('\n').join('\n     + │ ')}`))
    } else {
        log(chalk.gray('\n     (will be deleted)'))
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
            changes.push({ file, originalContent: content, matches })
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

function getIndentation(line: string): string {
    const match = line.match(/^(\s*)/)
    return match ? match[1] : ''
}

function applyIndentation(text: string, indent: string): string {
    const lines = text.split('\n')

    const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
    let minIndent = Infinity
    for (const line of nonEmptyLines) {
        const lineIndent = line.match(/^(\s*)/)?.[1].length ?? 0
        if (lineIndent < minIndent) {
            minIndent = lineIndent
        }
    }
    if (minIndent === Infinity) minIndent = 0

    return lines
        .map((line) => {
            const dedented = line.slice(minIndent)
            return indent + dedented
        })
        .join('\n')
}

function applyReplacements(
    content: string,
    matches: MatchResult[],
    replacement: string | undefined,
    excludeStart: boolean = false,
    excludeEnd: boolean = false,
): string {
    const lines = content.split('\n')
    const result: string[] = []
    let i = 0
    let matchIndex = 0

    const sortedMatches = [...matches].sort((a, b) => a.startLine - b.startLine)

    while (i < lines.length) {
        if (matchIndex < sortedMatches.length && i + 1 === sortedMatches[matchIndex].startLine) {
            const match = sortedMatches[matchIndex]
            const effectiveStartLine = excludeStart ? match.startLine + 1 : match.startLine
            const effectiveEndLine = excludeEnd ? match.endLine - 1 : match.endLine

            // Keep start line if excluded
            if (excludeStart) {
                result.push(lines[i])
            }

            // Add replacement if provided (only if there's content to replace)
            if (replacement !== undefined && effectiveStartLine <= effectiveEndLine) {
                const indentSourceLine = excludeStart ? match.startLine : match.startLine - 1
                const originalIndent = getIndentation(lines[Math.max(0, indentSourceLine)])
                const indentedReplacement = applyIndentation(replacement, originalIndent)
                result.push(indentedReplacement)
            }

            // Keep end line if excluded
            if (excludeEnd && match.endLine > match.startLine) {
                result.push(lines[match.endLine - 1])
            }

            i = match.endLine
            matchIndex++
        } else {
            result.push(lines[i])
            i++
        }
    }

    return result.join('\n')
}

async function applyApprovedChanges(
    repoName: string,
    changes: FileChange[],
    approvedMatchesByFile: Map<string, MatchResult[]>,
    replacement: string | undefined,
    excludeStart: boolean = false,
    excludeEnd: boolean = false,
): Promise<void> {
    const repoDir = path.join(GIT_CACHE_DIR, repoName)

    for (const change of changes) {
        const approvedMatches = approvedMatchesByFile.get(change.file)
        if (!approvedMatches || approvedMatches.length === 0) continue

        const filePath = path.join(repoDir, change.file)
        const newContent = applyReplacements(
            change.originalContent,
            approvedMatches,
            replacement,
            excludeStart,
            excludeEnd,
        )
        await Bun.write(filePath, newContent)
        log(chalk.gray(`  Written: ${change.file} (${approvedMatches.length} change(s))`))
    }
}

async function selectRepos<Repo extends { name: string }>(repos: Repo[], trackedRepoNames: string[]): Promise<Repo[]> {
    const trackedInMatches = repos.filter((r) => trackedRepoNames.includes(r.name))
    const hasTracked = trackedInMatches.length > 0

    const choices = [
        { value: 'all', name: 'All repos' },
        ...(hasTracked ? [{ value: 'tracked', name: `Only tracked repos (${trackedInMatches.length})` }] : []),
        ...repos.map((it) => ({
            name: trackedRepoNames.includes(it.name) ? `${it.name} (tracked)` : it.name,
            value: it.name,
        })),
    ]

    const response = await checkbox({
        message: 'Select repos to apply changes to',
        choices,
    })

    if (response.includes('all')) return repos
    if (response.includes('tracked')) return trackedInMatches
    if (response.length !== 0) return repos.filter((it) => response.includes(it.name))

    log(chalk.red('You must select at least one repo'))
    return selectRepos(repos, trackedRepoNames)
}
