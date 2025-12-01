import path from 'node:path'

import * as R from 'remeda'
import { confirm } from '@inquirer/prompts'
import chalk from 'chalk'

import { getAllRepos } from '../../../common/repos.ts'
import { getTeam } from '../../../common/config.ts'
import { getUpdatedGitterCache, Gitter } from '../../../common/git.ts'
import { BaseRepoNode } from '../../../common/octokit.ts'
import { GIT_CACHE_DIR } from '../../../common/cache.ts'
import { log, logError } from '../../../common/log.ts'

import { DistrolessBumpTypes, distrolessBumpTypes, getLatestDigestHash } from './images.ts'

export async function updateDistroless(type: string): Promise<void> {
    if (!isDistrolessBumpType(type)) {
        throw new Error(
            `Unknown distroless type: "${type || 'empty'}", must be one of: ${distrolessBumpTypes.join(', ')}`,
        )
    }

    const repos = await getAllRepos(await getTeam())
    const gitter = await getUpdatedGitterCache(repos)
    const { digest, image } = await getLatestDigestHash(type)

    log(`Latest image for ${type} is: ${image}@${digest}\n`)

    const relevantRepos = await getRelevantRepos(repos, image)

    const changes = await updateReposAndDiff(gitter, relevantRepos, image, digest)

    if (!changes.hasChanged) {
        log(
            `Found ${chalk.green(relevantRepos.length)} for type ${chalk.blueBright(type)}, none of them had digest changes`,
        )
        return
    }

    log(
        `Found ${chalk.green(relevantRepos.length)} repos of type ${chalk.blueBright(type)}, ${chalk.yellow(changes.changedRepos.length)} had changes:\n\t${changes.changedRepos.join('\n')}`,
    )

    const confirmResult = await confirm({
        message: `Do you want to commit and push these changes?`,
    })

    if (!confirmResult) {
        log(chalk.red('Aborting, no changes were committed or pushed'))
        return
    }

    try {
        await executeDistrolessUpdate(gitter, changes.changedRepos)
    } catch (e) {
        logError('Unable to push changes. :(', e)
        process.exit(1)
    }
}

function isDistrolessBumpType(type: string): type is DistrolessBumpTypes {
    return distrolessBumpTypes.includes(type as DistrolessBumpTypes)
}

async function updateReposAndDiff(
    gitter: Gitter,
    relevantRepos: string[],
    image: string,
    digest: string,
): Promise<{ hasChanged: boolean; digest: string; changedRepos: string[] }> {
    await Promise.all(relevantRepos.map((repo) => updateDockerfile(repo, image, digest)))
    const reposWithDiff = (
        await Promise.all(
            relevantRepos.map(async (repo) => {
                const git = gitter.createRepoGitClient(repo)
                return [repo, await git.diffSummary()] as const
            }),
        )
    ).filter(([, diff]) => diff.files.length > 0)

    if (reposWithDiff.length > 0) {
        return { hasChanged: true, digest: digest, changedRepos: reposWithDiff.map(([repo]) => repo) }
    }

    return { hasChanged: false, digest: digest, changedRepos: [] }
}

async function executeDistrolessUpdate(gitter: Gitter, reposWithDiff: string[]): Promise<void> {
    const pushed = await Promise.all(
        reposWithDiff.map(async (repo) => {
            const git = gitter.createRepoGitClient(repo)

            return git
                .add('Dockerfile')
                .commit(`automated: update distroless with newest digest`, ['--no-verify'])
                .push()
        }),
    )

    log(`Pushed changes in ${chalk.green(pushed.length)} repos`)
}

async function updateDockerfile(repo: string, image: string, digest: string): Promise<void> {
    const dockerfileFile = Bun.file(`${GIT_CACHE_DIR}/${repo}/Dockerfile`)
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
        R.filter(([, dockerfileImage]) => dockerfileImage != null),
        R.filter(([, dockerfileImage]) => {
            const relevantImage = dockerfileImage?.includes(image.replace('-debian11', ''))

            return relevantImage ?? false
        }),
        R.map(([repo]) => repo),
    )
}
