import chalk from 'chalk'

import packageJson from '../../../tsm-cli/package.json'
import { subtractDays } from '../../common/date-utils.ts'
import { log } from '../../common/log.ts'

export async function createSimpleSykmelding(fnr: string): Promise<void> {
    log(chalk.blue(`Creating simple sykmelding for ${chalk.yellow(fnr)}...`))

    const response = await postSykmelding(fnr)

    log(chalk.green(response.message))
}

async function postSykmelding(sykmeldtId: string): Promise<{ message: string }> {
    const headers = {
        'User-Agent': `TSM ${packageJson.version}`,
        Accept: '*/*',
        'Content-Type': 'application/json',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
    }

    const weekAgo = subtractDays(7)
    const payload = {
        fnr: sykmeldtId,
        syketilfelleStartdato: weekAgo,
        behandletDato: weekAgo,
        perioder: [
            {
                fom: weekAgo,
                tom: subtractDays(1),
                type: 'HUNDREPROSENT',
            },
        ],
        hoveddiagnose: {
            system: 'icd10',
            code: 'H100',
            text: 'Mukopurulent konjunktivitt',
        },
        arbeidsgiverNavn: 'Eksempel Arbeidsgiversen AS',
        fnrLege: '04056600324',
        herId: null,
        hprNummer: '9144889',
        yrkesskade: false,
        meldingTilArbeidsgiver: null,
        beskrivBistandNav: null,
        annenFraverGrunn: null,
        begrunnIkkeKontakt: null,
        vedlegg: false,
        vedleggMedVirus: false,
        virksomhetsykmelding: false,
        utdypendeOpplysninger: null,
        regelsettVersjon: '3',
        kontaktDato: null,
        bidiagnoser: [],
        diagnosekodesystem: 'icd10',
        diagnosekode: 'H100',
    }

    const response = await fetch('https://teamsykmelding-mock.intern.dev.nav.no/api/proxy/sykmelding/opprett', {
        credentials: 'include',
        headers: headers,
        body: JSON.stringify(payload),
        method: 'POST',
        mode: 'cors',
    })

    if (!response.ok) {
        throw new Error(`Could not post sykmelding: ${response.status} ${response.statusText}`)
    }

    return (await response.json()) as { message: string }
}
