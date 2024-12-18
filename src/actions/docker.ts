import path from 'node:path'

import * as R from 'remeda'
import chalk from 'chalk'

import { Gitter } from '../common/git.ts'
import { getAllRepos } from '../common/repos.ts'
import { getTeam } from '../common/config.ts'
import { GIT_CACHE_DIR } from '../common/cache.ts'
import { log } from '../common/log.ts'

export async function dockerImages(): Promise<void> {
    const gitter = new Gitter('cache')
    const repos = await getAllRepos(await getTeam())

    await Promise.all(repos.map((it) => gitter.cloneOrPull(it.name, it.defaultBranchRef.name, true)))

    const repoToImage = await Promise.all(
        repos.map(async (it) => {
            const bunFile = Bun.file(path.join(GIT_CACHE_DIR, it.name, 'Dockerfile'))
            if (!(await bunFile.exists())) {
                return [it.name, 'No Dockerfile'] as const
            }

            const content = await bunFile.text()
            const match = content.match(/FROM\s+([^\s:]+(?::[^\s]+)?)/g)
            if (match == null || match.length === 0) {
                return [it.name, 'Dockerfile without FROM'] as const
            }

            return [it.name, match.map((it) => it.toString())] as const
        }),
    )

    const grouped = R.groupBy(repoToImage, ([, image]) => (typeof image === 'string' ? image : image[image.length - 1]))

    if (grouped['No Dockerfile']) {
        log(chalk.yellow('Repos without Dockerfile:'))
        grouped['No Dockerfile'].forEach(([name]) => log(`- ${chalk.white(name)}`))
    }

    if (grouped['Dockerfile without FROM']) {
        log(chalk.red('Repos with Dockerfile without FROM:'))
        grouped['Dockerfile without FROM'].forEach(([name]) => log(`- ${chalk.red(name)}`))
    }

    Object.entries(grouped).forEach(([image, repos]) => {
        if (image === 'No Dockerfile' || image === 'Dockerfile without FROM') return

        log(chalk.green(`Image: ${image}`))
        repos.forEach(([name, images]) =>
            log(`- ${chalk.white(name)}${images.length > 1 ? ' (multi-step build)' : ''}`),
        )
    })
}
