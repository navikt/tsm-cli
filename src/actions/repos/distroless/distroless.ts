import * as clack from '@clack/prompts'
import chalk from 'chalk'
import path from 'node:path'
import * as R from 'remeda'

import { GIT_CACHE_DIR } from '../../../common/cache.ts'
import { getTeam } from '../../../common/config.ts'
import { getGitterCache, Gitter } from '../../../common/git.ts'
import { BaseRepoNode } from '../../../common/octokit.ts'
import { getAllRepos } from '../../../common/repos.ts'
import { tuiSession, withSpinner } from '../../../common/tui.ts'

import { DistrolessBumpTypes, distrolessBumpTypes, getLatestDigestHash } from './images.ts'

const COMMIT_MESSAGE = 'automated: update distroless with newest digest'

export async function updateDistroless(type: string): Promise<void> {
    if (!isDistrolessBumpType(type)) {
        throw new Error(
            `Unknown distroless type: "${type || 'empty'}", must be one of: ${distrolessBumpTypes.join(', ')}`,
        )
    }

    await tuiSession(chalk.bgCyan(chalk.black(` tsm repos --update-distroless ${type} `)), async () => {
        const team = await getTeam()

        const repos = await withSpinner(
            `Fetching repos for ${chalk.yellow(team)}`,
            () => getAllRepos(team),
            (repos) => `Found ${chalk.yellow(repos.length)} repos in ${chalk.yellow(team)}`,
        )

        const gitter = getGitterCache()

        await withSpinner(
            'Updating local git cache',
            async (spinner) => {
                let done = 0

                await Promise.all(
                    repos.map(async (repo) => {
                        await gitter.cloneOrPull(repo.name, repo.defaultBranchRef.name, true)
                        spinner.message(`Updating local git cache (${++done}/${repos.length})`)
                    }),
                )
            },
            () => `Updated ${chalk.yellow(repos.length)} repos`,
        )

        const { digest, image } = await withSpinner(
            `Fetching latest digest for ${chalk.yellow(type)}`,
            () => getLatestDigestHash(type),
            ({ digest, image }) => `Latest ${chalk.yellow(type)} image is ${image}@${chalk.yellow(digest)}`,
        )

        const relevantRepos = await withSpinner(
            `Looking for repos using ${image}`,
            () => getRelevantRepos(repos, image),
            (hits) => `Found ${chalk.yellow(hits.length)} repos using ${image}`,
        )

        if (relevantRepos.length === 0) {
            clack.log.warn(`No repos are using ${image}`)
            return
        }

        const changedRepos = await withSpinner(
            'Updating Dockerfiles',
            () => updateReposAndDiff(gitter, relevantRepos, image, digest),
            (changed) =>
                changed.length === 0
                    ? `All ${chalk.yellow(relevantRepos.length)} repos are already on the latest digest`
                    : `${chalk.yellow(changed.length)} of ${chalk.yellow(relevantRepos.length)} repos had digest changes`,
        )

        if (changedRepos.length === 0) return

        clack.note(changedRepos.map((it) => `${chalk.green('✓')} ${it}`).join('\n'), 'Ready to push')

        const confirmed = await clack.confirm({
            message: `Commit and push ${changedRepos.length} repos with "${COMMIT_MESSAGE}"?`,
        })

        if (clack.isCancel(confirmed) || !confirmed) {
            await revertDockerfiles(gitter, changedRepos)
            clack.log.warn('Aborting, no changes were committed or pushed')
            return
        }

        await executeDistrolessUpdate(gitter, changedRepos)
    })
}

function isDistrolessBumpType(type: string): type is DistrolessBumpTypes {
    return distrolessBumpTypes.includes(type as DistrolessBumpTypes)
}

/**
 * Writes the new digest into every relevant Dockerfile, then returns the repos that actually
 * ended up with a diff.
 */
async function updateReposAndDiff(
    gitter: Gitter,
    relevantRepos: string[],
    image: string,
    digest: string,
): Promise<string[]> {
    await Promise.all(relevantRepos.map((repo) => updateDockerfile(repo, image, digest)))

    const reposWithDiff = await Promise.all(
        relevantRepos.map(async (repo) => {
            const diff = await gitter.createRepoGitClient(repo).diffSummary()

            return [repo, diff.files.length > 0] as const
        }),
    )

    return reposWithDiff.filter(([, changed]) => changed).map(([repo]) => repo)
}

async function executeDistrolessUpdate(gitter: Gitter, reposWithDiff: string[]): Promise<void> {
    await withSpinner(
        'Pushing changes',
        async (spinner) => {
            const errors: string[] = []
            let done = 0

            for (const repo of reposWithDiff) {
                try {
                    await gitter
                        .createRepoGitClient(repo)
                        .add('Dockerfile')
                        .commit(COMMIT_MESSAGE, ['--no-verify'])
                        .push()
                } catch (e) {
                    errors.push(`${repo}: ${e as Error}`)
                }

                spinner.message(`Pushing changes (${++done}/${reposWithDiff.length})`)
            }

            return errors
        },
        (errors) =>
            errors.length === 0
                ? `Pushed changes in ${chalk.green(reposWithDiff.length)} repos`
                : `Pushed changes in ${chalk.green(reposWithDiff.length - errors.length)} repos, ${chalk.red(
                      errors.length,
                  )} failed:\n${chalk.gray(errors.join('\n'))}`,
    )
}

/**
 * Leaves the cached checkouts clean when the user aborts, the change is cheap to redo.
 */
async function revertDockerfiles(gitter: Gitter, repos: string[]): Promise<void> {
    await Promise.all(repos.map((repo) => gitter.createRepoGitClient(repo).checkout(['--', 'Dockerfile'])))
}

async function updateDockerfile(repo: string, image: string, digest: string): Promise<void> {
    const dockerfileFile = Bun.file(path.join(GIT_CACHE_DIR, repo, 'Dockerfile'))
    const content = await dockerfileFile.text()
    const updatedContent = content.replace(/FROM(.*)\n/, `FROM ${image}@${digest}\n`)

    await Bun.write(dockerfileFile, updatedContent)
}

async function getRelevantRepos(repos: BaseRepoNode<unknown>[], image: string): Promise<string[]> {
    const reposWithDockerfiles = await Promise.all(
        repos
            .map((it) => it.name)
            .map(async (repo): Promise<[string, string | null]> => {
                const dockerfileFile = Bun.file(path.join(GIT_CACHE_DIR, repo, 'Dockerfile'))
                if (!(await dockerfileFile.exists())) {
                    return [repo, null]
                }

                const dockerfileImage = (await dockerfileFile.text()).match(/FROM (.*)\n/)

                return [repo, dockerfileImage?.at(0) ?? null]
            }),
    )

    return R.pipe(
        reposWithDockerfiles,
        R.filter(([, dockerfileImage]) => dockerfileImage?.includes(image.replace('-debian11', '')) ?? false),
        R.map(([repo]) => repo),
    )
}
