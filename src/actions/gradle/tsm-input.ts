import { getOctokitClient } from '../../common/octokit.ts'

import { LibSpec } from './catalog-lib.ts'

export const TSM_INPUT: LibSpec = {
    module: 'no.nav.tsm.sykmelding:input',
    expectedAlias: 'tsm-sykmeldinger-input',
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
