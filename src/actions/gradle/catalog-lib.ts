import chalk from 'chalk'
import path from 'node:path'

import { GIT_CACHE_DIR } from '../../common/cache.ts'

/** Path of the version catalog, relative to the repo root. */
export const CATALOG_FILE = 'gradle/libs.versions.toml'

/**
 * A tsm lib we track across the team's repos.
 */
export type LibSpec = {
    /** The maven coordinate, e.g. `no.nav.tsm.regulus:regula`. */
    module: string
    /** The version catalog alias, and version ref, we expect it to be declared with. */
    expectedAlias: string
}

export type LibUsage =
    | {
          /** Declared through gradle/libs.versions.toml, which is what we want. */
          source: 'catalog'
          /** The catalog alias, e.g. `tsm-regula`. */
          alias: string
          /** The `version.ref` the alias points at, null if the version is inlined in the catalog. */
          versionRef: string | null
          version: string | null
      }
    | {
          /** Declared directly in build.gradle.kts, which we'd rather not have. */
          source: 'build.gradle.kts'
          /** The version variable used, e.g. `regulaVersion`, null if it's a literal. */
          variable: string | null
          version: string | null
      }

export type RepoLibUsage = { name: string; usage: LibUsage }

/**
 * Looks for a lib in every build.gradle.kts in a repo, either as a version catalog reference
 * (`libs.tsm.regula`) or declared directly in the build file. Returns null for repos that don't
 * use the lib at all.
 */
export async function findLibUsage(repo: string, spec: LibSpec): Promise<LibUsage | null> {
    const buildFiles = await readBuildFiles(repo)
    if (buildFiles.length === 0) return null

    const buildContent = buildFiles.join('\n')

    const inline = findInlineDeclaration(buildContent, spec)
    if (inline != null) return inline

    const catalog = await readCatalog(repo)
    if (catalog == null) return null

    const alias = findCatalogAlias(catalog, spec)
    if (alias == null) return null

    // The gradle accessor for `tsm-sykmeldinger-input` is `libs.tsm.sykmeldinger.input`
    const accessor = `libs.${alias.name.replaceAll('-', '.')}`
    if (!buildContent.includes(accessor)) return null

    return {
        source: 'catalog',
        alias: alias.name,
        versionRef: alias.versionRef,
        version: alias.versionRef != null ? findCatalogVersion(catalog, alias.versionRef) : alias.version,
    }
}

/**
 * Finds every repo using the lib, in the order the repos were given.
 */
export async function findLibRepos(repos: string[], spec: LibSpec): Promise<RepoLibUsage[]> {
    const usages = await Promise.all(repos.map(async (name) => ({ name, usage: await findLibUsage(name, spec) })))

    return usages.filter((it): it is RepoLibUsage => it.usage != null)
}

/**
 * Only repos using the expected catalog alias and version ref, with a resolvable version, are safe
 * to bump automatically.
 */
export function isUpdatable(usage: LibUsage, spec: LibSpec): boolean {
    return (
        usage.source === 'catalog' &&
        usage.alias === spec.expectedAlias &&
        usage.versionRef === spec.expectedAlias &&
        usage.version != null
    )
}

/**
 * One line describing how (and how correctly) a lib is declared, prefixed by the given label.
 */
export function toUsageLine(label: string, usage: LibUsage, spec: LibSpec): string {
    const version = usage.version != null ? chalk.white(usage.version) : chalk.red('unknown version')
    const warn = (note: string): string => `${chalk.yellow('▲')} ${label}: ${version} ${chalk.gray(`(${note})`)}`

    if (usage.source === 'build.gradle.kts') {
        return warn(usage.variable != null ? `$${usage.variable} in build.gradle.kts` : 'inline in build.gradle.kts')
    } else if (usage.versionRef == null) {
        return warn('version inlined in the catalog')
    } else if (usage.versionRef !== spec.expectedAlias) {
        return warn(`version.ref ${usage.versionRef}`)
    } else if (usage.version == null) {
        return `${chalk.red('✗')} ${label}: ${chalk.red(`${spec.expectedAlias} not declared in ${CATALOG_FILE}`)}`
    } else if (usage.alias !== spec.expectedAlias) {
        return warn(`alias ${usage.alias}`)
    }

    return `${chalk.green('✓')} ${label}: ${version}`
}

/**
 * Writes a new version for the repo's `[versions]` entry in the version catalog. Only correctly
 * configured repos can be updated.
 */
export async function setCatalogVersion(repo: RepoLibUsage, spec: LibSpec, version: string): Promise<void> {
    if (!isUpdatable(repo.usage, spec)) {
        throw new Error(`${repo.name} does not declare ${spec.expectedAlias} in ${CATALOG_FILE}`)
    }

    const file = Bun.file(path.join(GIT_CACHE_DIR, repo.name, CATALOG_FILE))
    const content = await file.text()
    const updated = content.replace(
        new RegExp(`^(\\s*${escape(spec.expectedAlias)}\\s*=\\s*)"[^"]+"`, 'm'),
        `$1"${version}"`,
    )

    if (updated === content) {
        throw new Error(`Unable to update ${spec.expectedAlias} in ${repo.name}/${CATALOG_FILE}`)
    }

    await Bun.write(file, updated)
}

async function readBuildFiles(repo: string): Promise<string[]> {
    const repoDir = path.join(GIT_CACHE_DIR, repo)
    const glob = new Bun.Glob('**/build.gradle.kts')
    const contents: string[] = []

    for await (const file of glob.scan({ cwd: repoDir, absolute: true })) {
        if (file.includes(`${path.sep}build${path.sep}`)) continue

        contents.push(await Bun.file(file).text())
    }

    return contents
}

async function readCatalog(repo: string): Promise<string | null> {
    const file = Bun.file(path.join(GIT_CACHE_DIR, repo, CATALOG_FILE))

    return (await file.exists()) ? await file.text() : null
}

/**
 * Matches e.g. `implementation("no.nav.tsm.regulus:regula:$regulaVersion")` or a hardcoded
 * `...:regula:41")`.
 */
function findInlineDeclaration(content: string, spec: LibSpec): LibUsage | null {
    const match = content.match(new RegExp(`${escape(spec.module)}:([^"']+)`))
    if (match == null) return null

    const declared = match[1]
    const variable = declared.match(/^\$\{?(\w+)}?$/)?.[1] ?? null

    return {
        source: 'build.gradle.kts',
        variable,
        version: variable != null ? findGradleVariable(content, variable) : declared,
    }
}

/**
 * Matches e.g. `tsm-regula = { module = "no.nav.tsm.regulus:regula", version.ref = "tsm-regula" }`.
 */
function findCatalogAlias(
    catalog: string,
    spec: LibSpec,
): { name: string; versionRef: string | null; version: string | null } | null {
    const match = catalog.match(new RegExp(`^\\s*([\\w.-]+)\\s*=\\s*\\{[^}]*${escape(spec.module)}"[^}]*}`, 'm'))
    if (match == null) return null

    const [line, name] = match

    return {
        name,
        versionRef: line.match(/version\.ref\s*=\s*"([^"]+)"/)?.[1] ?? null,
        version: line.match(/version\s*=\s*"([^"]+)"/)?.[1] ?? null,
    }
}

function findCatalogVersion(catalog: string, ref: string): string | null {
    return catalog.match(new RegExp(`^\\s*${escape(ref)}\\s*=\\s*"([^"]+)"`, 'm'))?.[1] ?? null
}

function findGradleVariable(content: string, variable: string): string | null {
    return content.match(new RegExp(`val\\s+${variable}\\s*=\\s*"([^"]+)"`))?.[1] ?? null
}

function escape(value: string): string {
    return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
