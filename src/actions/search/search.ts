import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { spawn } from 'bun'
import { idnr } from '@navikt/fnrvalidator'
import chalk from 'chalk'

import { getTeam } from '../../common/config.ts'
import { getAllRepos, getRepo } from '../../common/repos.ts'
import { logError, log, logNoNewLine } from '../../common/log.ts'
import { BaseRepoNode } from '../../common/octokit.ts'

import { getIgnoreList } from './ignore-list.ts'

export const IDNUMBER_REGEX = /\b\d{11}\b/g

interface Result {
    hit: string
    repo: string
    commit: string
    author: string
}
export async function searchRepos(
    team?: string,
    repoFilter?: string,
    search: string = IDNUMBER_REGEX.source,
    includeArchived: boolean = false,
): Promise<void> {
    let repos: BaseRepoNode<unknown>[] = []
    const regex = RegExp(search, 'g')

    const ignoreList = await getIgnoreList(search)

    if (repoFilter?.includes('/')) {
        repos = await getRepo(repoFilter)
    } else {
        const tempRepos = await getAllRepos(team ?? (await getTeam()), includeArchived)
        repos = tempRepos.filter((r) => r.name.includes(repoFilter ?? ''))
    }

    const results: Result[] = []
    for (const repo of repos) {
        logNoNewLine(repo.name)
        const tempDir = await mkdtemp(join(tmpdir(), `scan-${repo.name}-`))
        try {
            const cloneProc = spawn(['git', 'clone', '--quiet', `git@github.com:navikt/${repo.name}.git`, tempDir], {
                stdout: 'ignore',
                stderr: 'inherit',
            })

            await cloneProc.exited

            if (cloneProc.exitCode !== 0) {
                log(chalk.red('Failed to clone'))
                continue
            }

            const repoResult = await searchRepo(tempDir, repo.name, regex, ignoreList)
            results.push(...repoResult)
        } catch (error) {
            logError(chalk.red(`\nError processing ${repo.name}:`), error)
        } finally {
            await rm(tempDir, { recursive: true, force: true })
        }
        // Github ratelimit
        await new Promise((resolve) => setTimeout(resolve, 100))
    }

    if (results.length === 0) {
        log(chalk.green('No results found in any repository.'))
        return
    }

    // Group by unique values
    const distinctResults = new Map<string, Result[]>()
    for (const r of results) {
        if (!distinctResults.has(r.hit)) {
            distinctResults.set(r.hit, [])
        }
        distinctResults.get(r.hit)?.push(r)
    }

    log(`Found ${chalk.red(distinctResults.size.toString())} distinct results, ${results.length} total occurrences.\n`)

    for (const [result, occurrences] of distinctResults) {
        log(`${chalk.red('result:')} ${chalk.yellow(result)}`)

        const byRepo = new Map<string, number>()
        occurrences.forEach((o) => {
            byRepo.set(o.repo, (byRepo.get(o.repo) || 0) + 1)
        })

        log(`   Found in repositories:`)
        for (const [repoName, count] of byRepo) {
            log(`   - ${chalk.blue(repoName)} (${count} occurrences)`)
        }

        log(`   commits:`)
        occurrences.forEach((occ) => {
            log(`     ↳ Commit ${chalk.green(occ.commit)} by ${occ.author} in ${occ.repo}`)
        })
        log('-'.repeat(40))
    }
}
async function searchRepo(
    repoPath: string,
    repoName: string,
    searchRegexp: RegExp,
    ignoreList: string[],
): Promise<Result[]> {
    const results: Result[] = []
    const proc = spawn(['git', 'log', '-p', '--all', '--unified=0'], {
        cwd: repoPath,
        stdout: 'pipe',
    })

    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let currentCommit = 'Unknown'
    let currentAuthor = 'Unknown'
    let found = false

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value)
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
                // Track context
                if (line.startsWith('commit ')) {
                    currentCommit = line.substring(7, 15)
                } else if (line.startsWith('Author: ')) {
                    currentAuthor = line.substring(8).trim()
                }

                if (!line.startsWith('+')) continue

                const matches = line.match(searchRegexp)
                if (matches) {
                    for (const match of matches) {
                        if (!shouldIgnore(searchRegexp, match, ignoreList)) {
                            results.push({
                                hit: match,
                                repo: repoName,
                                commit: currentCommit,
                                author: currentAuthor,
                            })
                            found = true
                            log(
                                `\n  ${chalk.red('✖')} ${chalk.yellow(match)} in commit ${chalk.green(currentCommit)} by ${currentAuthor}`,
                            )
                        }
                    }
                }
            }
        }
    } catch (err) {
        logError(`Error scanning ${repoName}:`, err)
    }

    if (!found) {
        log(chalk.green(` ✓ Clean `))
    }
    return results
}

function shouldIgnore(searchRegex: RegExp, hit: string, ignoreList: string[]): boolean {
    if (ignoreList.includes(hit)) return true

    if (searchRegex.source === IDNUMBER_REGEX.source) {
        const thirdDigit = parseInt(hit[2])
        if (thirdDigit > 7) return true
        const validIdent = idnr(hit)
        return validIdent.status === 'invalid'
    }
    return false
}

if (import.meta.main) {
    try {
        await searchRepos(undefined, undefined, undefined, true)
    } catch (e) {
        logError('\n' + chalk.red('FATAL ERROR:'), e)
        process.exit(1)
    }
}
