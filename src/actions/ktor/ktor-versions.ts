import path from 'node:path'

import { GIT_CACHE_DIR } from '../../common/cache.ts'
import { getOctokitClient } from '../../common/octokit.ts'

export const EXPECTED_VERSION_VARIABLE = 'tsmKtorVersion'

const TSM_KTOR_REGEX = /no\.nav\.tsm:ktor[^:]*:\$\{?(\w+)}?/

export type KtorRepo = {
    name: string
    /** The variable used for the tsm-ktor version, e.g. `tsmKtorVersion`. */
    variable: string | null
    /** The value of that variable, e.g. `1.1.7`. */
    version: string | null
}

/**
 * Latest released version of navikt/tsm-ktor, without the leading `v`.
 */
export async function getLatestTsmKtorVersion(): Promise<string> {
    const { data } = await getOctokitClient().rest.repos.getLatestRelease({
        owner: 'navikt',
        repo: 'tsm-ktor',
    })

    return data.tag_name.replace(/^v/, '')
}

export function settingsGradleFile(repo: string): ReturnType<typeof Bun.file> {
    return Bun.file(path.join(GIT_CACHE_DIR, repo, 'settings.gradle.kts'))
}

const TSM_KTOR_LIBS_REGEX = /\btsmKtorLibs((?:\.\w+)+)/g

export type KtorLibsRepo = {
    name: string
    /** Sorted, unique list of used libs, e.g. `["core", "kafka.sykmeldinger"]`. */
    libs: string[]
}

/**
 * Looks for `tsmKtorLibs.<lib>` references in the repo's build.gradle.kts files, returning null
 * for repos that don't use the version catalog at all.
 */
export async function getKtorLibsRepo(name: string): Promise<KtorLibsRepo | null> {
    const repoDir = path.join(GIT_CACHE_DIR, name)
    const glob = new Bun.Glob('**/build.gradle.kts')

    const libs = new Set<string>()

    for await (const file of glob.scan({ cwd: repoDir, absolute: true })) {
        if (file.includes(`${path.sep}build${path.sep}`)) continue

        const content = await Bun.file(file).text()

        for (const [, lib] of content.matchAll(TSM_KTOR_LIBS_REGEX)) {
            libs.add(lib.slice(1))
        }
    }

    if (libs.size === 0) return null

    return { name, libs: [...libs].sort() }
}

/**
 * Looks for `no.nav.tsm:ktor` in the repo's settings.gradle.kts, returning null for repos that
 * don't use it at all.
 */
export async function getKtorRepo(name: string): Promise<KtorRepo | null> {
    const file = settingsGradleFile(name)
    if (!(await file.exists())) return null

    const content = await file.text()
    if (!content.includes('no.nav.tsm:ktor')) return null

    const variable = content.match(TSM_KTOR_REGEX)?.[1] ?? null

    return { name, variable, version: variable != null ? findVersion(content, variable) : null }
}

/**
 * Writes a new version for the repo's version variable, e.g. `val tsmKtorVersion = "1.1.7"`.
 */
export async function setKtorVersion(repo: KtorRepo, version: string): Promise<void> {
    if (repo.variable == null) {
        throw new Error(`${repo.name} has no tsm-ktor version variable`)
    }

    const file = settingsGradleFile(repo.name)
    const content = await file.text()
    const updated = content.replace(versionRegex(repo.variable), `$1"${version}"`)

    if (updated === content) {
        throw new Error(`Unable to update ${repo.variable} in ${repo.name}/settings.gradle.kts`)
    }

    await Bun.write(file, updated)
}

function findVersion(content: string, variable: string): string | null {
    return content.match(new RegExp(`val\\s+${variable}\\s*=\\s*"([^"]+)"`))?.[1] ?? null
}

function versionRegex(variable: string): RegExp {
    return new RegExp(`(val\\s+${variable}\\s*=\\s*)"[^"]+"`)
}
