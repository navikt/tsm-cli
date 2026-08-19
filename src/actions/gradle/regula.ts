import { getOctokitClient } from '../../common/octokit.ts'

import { LibSpec } from './catalog-lib.ts'

/**
 * The libs published by navikt/regulus-regula.
 */
export const REGULA_LIBS: LibSpec[] = [
    { module: 'no.nav.tsm.regulus:regula', expectedAlias: 'tsm-regula' },
    { module: 'no.nav.tsm.regulus:juridisk', expectedAlias: 'tsm-juridisk' },
]

/** The lib name without the group, e.g. `regula`. */
export function libName(spec: LibSpec): string {
    return spec.module.split(':')[1]
}

/**
 * Latest released version of navikt/regulus-regula, without the leading `v`. Both libs are
 * published from that repo, so they share the version.
 */
export async function getLatestRegulaVersion(): Promise<string> {
    const { data } = await getOctokitClient().rest.repos.getLatestRelease({
        owner: 'navikt',
        repo: 'regulus-regula',
    })

    return data.tag_name.replace(/^v/, '')
}
