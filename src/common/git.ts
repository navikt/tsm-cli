import fs from 'node:fs'
import path from 'node:path'

import simpleGit, { CleanOptions, ResetMode, SimpleGit } from 'simple-git'
import chalk from 'chalk'

import { GIT_CACHE_DIR } from './cache.ts'
import { log, logError, logProgressDot } from './log.ts'
import { BaseRepoNode } from './octokit.ts'

type GitterType = 'cache' | { type: 'user-config'; dir: string }

export class Gitter {
    private readonly type: GitterType
    private readonly git: SimpleGit

    constructor(type: GitterType) {
        this.type = type
        if (type === 'cache') {
            fs.mkdirSync(GIT_CACHE_DIR, { recursive: true })

            this.git = simpleGit({
                baseDir: GIT_CACHE_DIR,
                binary: 'git',
                maxConcurrentProcesses: 10,
            })
        } else {
            this.git = simpleGit({
                baseDir: type.dir,
                binary: 'git',
                maxConcurrentProcesses: 10,
            })
        }
    }

    public async cloneOrPull(
        repo: string,
        defaultBranch: string,
        silent = false,
        shallow = false,
    ): Promise<'updated' | 'cloned' | { type: 'error'; message: string }> {
        return this.exists(repo) ? this.pull(repo, defaultBranch, silent) : this.clone(repo, silent, shallow)
    }

    private async pull(
        repo: string,
        defaultBranch: string,
        silent: boolean,
    ): Promise<'updated' | 'cloned' | { type: 'error'; message: string }> {
        const t1 = performance.now()
        const repoClient = this.createRepoGitClient(repo)

        if (this.type === 'cache') {
            // For repos that haved changed main, or fail for other reason
            try {
                await repoClient.fetch(['--all']) // Fetch all branches
                await repoClient.checkout(defaultBranch)
            } catch (error) {
                logError(`Unable to fetch for ${repo} (branch: ${defaultBranch}), cause: ${error}`)
                logError('Nuking repo and trying to clone again')
                fs.rmdirSync(path.join(GIT_CACHE_DIR, repo), { recursive: true })
                return this.clone(repo, silent, false)
            }

            try {
                await repoClient
                    .clean([CleanOptions.FORCE, CleanOptions.RECURSIVE])
                    .reset(ResetMode.HARD, ['origin/HEAD'])
                    .pull({
                        '--rebase': null,
                    })
            } catch (error) {
                logError(`Unable to pull for ${repo} (branch: ${defaultBranch}), cause: ${error}`)
            }
        } else {
            try {
                const currentBranch = await repoClient.revparse(['--abbrev-ref', 'HEAD'])
                if (currentBranch.trim() === defaultBranch) {
                    await repoClient.pull({ '--rebase': null })
                } else {
                    await repoClient.fetch('origin', `${defaultBranch}:${defaultBranch}`)
                }
            } catch (e) {
                return {
                    type: 'error',
                    message: (e as Error).message,
                }
            }
        }

        if (!silent) {
            log(`${repo}, exists, pulled OK (${Math.round(performance.now() - t1)}ms)`)
        }

        logProgressDot()
        return 'updated'
    }

    private async clone(repo: string, silent: boolean, shallow: boolean): Promise<'cloned'> {
        const remote = `git@github.com:navikt/${repo}.git`

        const t1 = performance.now()
        await this.git.clone(remote, repo, shallow ? { '--depth': 1 } : undefined)

        if (!silent) {
            log(`Cloned ${repo}${shallow ? ' (shallow)' : ''} OK (${Math.round(performance.now() - t1)}ms))`)
        }

        logProgressDot()
        return 'cloned'
    }

    public createRepoGitClient(repo: string): SimpleGit {
        if (this.type === 'cache') {
            return simpleGit({
                baseDir: `${GIT_CACHE_DIR}/${repo}`,
                binary: 'git',
                maxConcurrentProcesses: 1,
            })
        } else {
            return simpleGit({
                baseDir: `${this.type.dir}/${repo}`,
                binary: 'git',
                maxConcurrentProcesses: 1,
            })
        }
    }

    private exists(repo: string): boolean {
        if (this.type === 'cache') {
            return fs.existsSync(path.join(GIT_CACHE_DIR, repo))
        } else {
            return fs.existsSync(path.join(this.type.dir, repo))
        }
    }
}

export async function getUpdatedGitterCache(repos: BaseRepoNode<unknown>[]): Promise<Gitter> {
    const gitter = new Gitter('cache')
    const results = await Promise.all(repos.map((it) => gitter.cloneOrPull(it.name, it.defaultBranchRef.name, true)))

    log(
        `\nUpdated ${chalk.yellow(results.filter((it) => it === 'updated').length)} and cloned ${chalk.yellow(
            results.filter((it) => it === 'cloned').length,
        )} repos\n`,
    )

    return gitter
}

export function getGitterCache(): Gitter {
    return new Gitter('cache')
}
