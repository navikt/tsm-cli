import path from 'node:path'

import { GIT_CACHE_DIR } from '../../common/cache.ts'
import { getOctokitClient } from '../../common/octokit.ts'

/** The coordinate we are looking for in build.gradle.kts and the version catalog. */
export const TSM_INPUT_MODULE = 'no.nav.tsm.sykmelding:input'

/** The version catalog alias (and version ref) we expect the lib to be declared with. */
export const EXPECTED_ALIAS = 'tsm-sykmeldinger-input'

/** Path of the version catalog, relative to the repo root. */
export const CATALOG_FILE = 'gradle/libs.versions.toml'

export type InputRepo = {
    name: string
} & (
    | {
          /** Declared through gradle/libs.versions.toml. */
          source: 'catalog'
          /** The catalog alias, e.g. `tsm-sykmeldinger-input`. */
          alias: string
          /** The `version.ref` the alias points at, null if the version is inlined in the catalog. */
          versionRef: string | null
          version: string | null
      }
    | {
          /** Declared directly in build.gradle.kts, which we'd rather not have. */
          source: 'build.gradle.kts'
          /** The version variable used, e.g. `sykmeldingInputVersion`, null if it's a literal. */
          variable: string | null
          version: string | null
      }
)

/**
 * Looks for `no.nav.tsm.sykmelding:input` in a repo, either as a version catalog reference
 * (`libs.tsm.sykmeldinger.input`) or declared directly in a build.gradle.kts. Returns null for
 * repos that don't use the lib at all.
 */
export async function getInputRepo(name: string): Promise<InputRepo | null> {
    const buildFiles = await readBuildFiles(name)
    if (buildFiles.length === 0) return null

    const buildContent = buildFiles.join('\n')

    const inline = findInlineDeclaration(buildContent)
    if (inline != null) return { name, ...inline }

    const catalog = await readCatalog(name)
    if (catalog == null) return null

    const alias = findCatalogAlias(catalog)
    if (alias == null) return null

    // The gradle accessor for `tsm-sykmeldinger-input` is `libs.tsm.sykmeldinger.input`
    const accessor = `libs.${alias.name.replaceAll('-', '.')}`
    if (!buildContent.includes(accessor)) return null

    return {
        name,
        source: 'catalog',
        alias: alias.name,
        versionRef: alias.versionRef,
        version: alias.versionRef != null ? findCatalogVersion(catalog, alias.versionRef) : alias.version,
    }
}

/**
 * Latest released version of navikt/tsm-sykmelding-input, without the leading `v`.
 */
export async function getLatestTsmInputVersion(): Promise<string> {
    const { data } = await getOctokitClient().rest.repos.getLatestRelease({
        owner: 'navikt',
        repo: 'tsm-sykmelding-input',
    })

    return data.tag_name.replace(/^v/, '')
}

/**
 * Writes a new version for the repo's `[versions]` entry in the version catalog. Only repos that
 * are correctly configured (expected alias and version ref) can be updated.
 */
export async function setInputVersion(repo: InputRepo, version: string): Promise<void> {
    if (!isUpdatable(repo)) {
        throw new Error(`${repo.name} does not declare ${EXPECTED_ALIAS} in ${CATALOG_FILE}`)
    }

    const file = Bun.file(path.join(GIT_CACHE_DIR, repo.name, CATALOG_FILE))
    const content = await file.text()
    const updated = content.replace(
        new RegExp(`^(\\s*${escape(EXPECTED_ALIAS)}\\s*=\\s*)"[^"]+"`, 'm'),
        `$1"${version}"`,
    )

    if (updated === content) {
        throw new Error(`Unable to update ${EXPECTED_ALIAS} in ${repo.name}/${CATALOG_FILE}`)
    }

    await Bun.write(file, updated)
}

/**
 * Only repos using the expected catalog alias and version ref, with a resolvable version, are safe
 * to bump automatically.
 */
export function isUpdatable(repo: InputRepo): boolean {
    return (
        repo.source === 'catalog' &&
        repo.alias === EXPECTED_ALIAS &&
        repo.versionRef === EXPECTED_ALIAS &&
        repo.version != null
    )
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
 * Matches e.g. `implementation("no.nav.tsm.sykmelding:input:$sykmeldingInputVersion")` or a
 * hardcoded `...:input:27")`.
 */
function findInlineDeclaration(
    content: string,
): { source: 'build.gradle.kts'; variable: string | null; version: string | null } | null {
    const match = content.match(new RegExp(`${escape(TSM_INPUT_MODULE)}:([^"']+)`))
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
 * Matches e.g. `tsm-sykmeldinger-input = { module = "no.nav.tsm.sykmelding:input", version.ref = "..." }`.
 */
function findCatalogAlias(catalog: string): { name: string; versionRef: string | null; version: string | null } | null {
    const match = catalog.match(new RegExp(`^\\s*([\\w.-]+)\\s*=\\s*\\{[^}]*${escape(TSM_INPUT_MODULE)}[^}]*}`, 'm'))
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
