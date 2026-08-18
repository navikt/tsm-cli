import * as clack from '@clack/prompts'
import chalk from 'chalk'
import path from 'node:path'
import * as R from 'remeda'

import { GIT_CACHE_DIR } from '../common/cache.ts'
import { getTeam } from '../common/config.ts'
import { getGitterCache } from '../common/git.ts'
import { getAllRepos } from '../common/repos.ts'
import { tuiSession, withSpinner } from '../common/tui.ts'

const NO_DOCKERFILE = 'No Dockerfile'
const NO_FROM = 'Dockerfile without FROM'

/** Either one of the sentinel values above, or every `FROM` line in the Dockerfile. */
type RepoImages = readonly [name: string, images: string | string[]]

export async function dockerImages(): Promise<void> {
    await tuiSession(chalk.bgCyan(chalk.black(' tsm docker images ')), async () => {
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

        const grouped = await withSpinner(
            'Reading Dockerfiles',
            async () => {
                const repoToImage = await Promise.all(repos.map((it) => getImagesForRepo(it.name)))

                return R.groupBy(repoToImage, ([, image]) =>
                    typeof image === 'string' ? image : image[image.length - 1],
                )
            },
            (grouped) => `Found ${chalk.yellow(imageCount(grouped))} distinct base images`,
        )

        const images = R.pipe(
            R.entries(grouped),
            R.filter(([image]) => image !== NO_DOCKERFILE && image !== NO_FROM),
            R.sortBy([([, repos]) => repos?.length ?? 0, 'desc']),
        )

        if (images.length > 0) {
            clack.log.message(images.map(toImageSection).join('\n\n'))
        }

        if (grouped[NO_DOCKERFILE]) {
            clack.log.warn(
                `Repos without Dockerfile:\n${grouped[NO_DOCKERFILE].map(([name]) => `  ${name}`).join('\n')}`,
            )
        }

        if (grouped[NO_FROM]) {
            clack.log.error(
                `Repos with Dockerfile without FROM:\n${grouped[NO_FROM].map(([name]) => `  ${name}`).join('\n')}`,
            )
        }
    })
}

async function getImagesForRepo(name: string): Promise<RepoImages> {
    const bunFile = Bun.file(path.join(GIT_CACHE_DIR, name, 'Dockerfile'))
    if (!(await bunFile.exists())) {
        return [name, NO_DOCKERFILE] as const
    }

    const content = await bunFile.text()
    const match = content.match(/FROM\s+([^\s:]+(?::[^\s]+)?)/g)
    if (match == null || match.length === 0) {
        return [name, NO_FROM] as const
    }

    return [name, match.map((it) => it.replace(/^FROM\s+/, ''))] as const
}

function imageCount(grouped: Partial<Record<string, RepoImages[]>>): number {
    return R.keys(grouped).filter((it) => it !== NO_DOCKERFILE && it !== NO_FROM).length
}

function toImageSection([image, repos]: [string, RepoImages[] | undefined]): string {
    const lines = (repos ?? []).map(
        ([name, images]) => `  ${name}${images.length > 1 ? chalk.gray(' (multi-step build)') : ''}`,
    )

    return [chalk.green(`${image} (${repos?.length ?? 0})`), ...lines].join('\n')
}
