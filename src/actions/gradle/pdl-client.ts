import { getOctokitClient } from '../../common/octokit.ts'

import { LibSpec } from './catalog-lib.ts'

export const PDL_CLIENT: LibSpec = {
    module: 'no.nav.tsm:pdl-client',
    expectedAlias: 'tsm-pdl-client',
}

/**
 * Latest released version of navikt/tsm-pdl-cache, which publishes no.nav.tsm:pdl-client, without the leading `v`.
 */
export async function getLatestPdlClientVersion(): Promise<string> {
    const { data } = await getOctokitClient().rest.repos.getLatestRelease({
        owner: 'navikt',
        repo: 'tsm-pdl-cache',
    })

    return data.tag_name.replace(/^v/, '')
}
