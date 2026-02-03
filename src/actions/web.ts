import * as R from 'remeda'
import chalk from 'chalk'
import { search } from '@inquirer/prompts'

import { log } from '../common/log.ts'
import { openUrl } from '../common/open-url.ts'

type Envs = {
    dev: string
    prod: string
    demo?: string
}

const isKnowit = ['andreassagenaspaas', 'karl'].includes(Bun.env.USER ?? '')
const knowitPages = {
    ubw: 'https://ubw.knowit.se',
}
const hiddenPages = {
    helg: 'https://helg.karl.run/nyan',
}

const staticPages = {
    mock: 'https://teamsykmelding-mock.ansatt.dev.nav.no/',
    docs: 'https://loop.cloud.microsoft/p/eyJ3Ijp7InUiOiJodHRwczovL25hdm5vLnNoYXJlcG9pbnQuY29tLz9uYXY9Y3owbE1rWW1aRDFpSVdKV1VXYzViMEpOY2xVdFVFeHVhRVo2WkdOaFVsQlpTVzlzVFU1NWJXUkdhbWR2VlVaT2J6WmFTVTF0VTFKUldEbFBTalZSV25aU1JVcFhNV0ZJWlRFbVpqMHdNVVZLVlRKTVNFSlJSa2t5TkZsRVFVMHpSa0l5UVV0UFQwWTJRazlUTmxBMUptTTlKbVpzZFdsa1BURSUzRCIsInIiOmZhbHNlfSwicCI6eyJ1IjoiaHR0cHM6Ly9uYXZuby5zaGFyZXBvaW50LmNvbS86Zmw6L3IvY29udGVudHN0b3JhZ2UvQ1NQX2Y2MjA1NDZkLTRjODAtNGZhZC04ZjJlLTc4NDVjZGQ3MWE0NC9Eb2t1bWVudGJpYmxpb3Rlay9Mb29wQXBwRGF0YS9VbnRpdGxlZCUyMDUubG9vcD9kPXc2NmFhZTA0NTg1YWY0MzE4OTUxNTY1NjMwYTNiOWFmNiZjc2Y9MSZ3ZWI9MSZuYXY9Y3owbE1rWmpiMjUwWlc1MGMzUnZjbUZuWlNVeVJrTlRVRjltTmpJd05UUTJaQzAwWXpnd0xUUm1ZV1F0T0dZeVpTMDNPRFExWTJSa056RmhORFFtWkQxaUlXSldVV2M1YjBKTmNsVXRVRXh1YUVaNlpHTmhVbEJaU1c5c1RVNTViV1JHYW1kdlZVWk9ielphU1UxdFUxSlJXRGxQU2pWUlduWlNSVXBYTVdGSVpURW1aajB3TVVWS1ZUSk1TRU5HTkVOV1IwNU1ORVpFUWtKYVMwWk1SazFOUmtSWVIxaFhKbU05SlRKR0ptWnNkV2xrUFRFbVlUMU1iMjl3UVhCd0puQTlKVFF3Wm14MWFXUjRKVEpHYkc5dmNDMXdZV2RsTFdOdmJuUmhhVzVsY2laNFBTVTNRaVV5TW5jbE1qSWxNMEVsTWpKVU1GSlVWVWg0ZFZsWVduVmllVFY2WVVkR2VWcFlRblpoVnpVd1RHMU9kbUpZZUdsSlYwcFhWVmRqTldJd1NrNWpiRlYwVlVWNGRXRkZXalphUjA1b1ZXeENXbE5YT1hOVVZUVTFZbGRTUjJGdFpIWldWVnBQWW5wYVlWTlZNWFJWTVVwU1YwUnNVRk5xVmxKWGJscFRVbFZ3V0UxWFJrbGFWRVk0VFVSR1JsTnNWWGxVUldoRFZWVmFTazFxVWxwU1JVWk9UVEJhUTAxclJreFVNRGxIVG10S1VGVjZXbEZPVVNVelJDVXpSQ1V5TWlVeVF5VXlNbWtsTWpJbE0wRWxNakptTmpVMU9XSmtZeTFpTXpsbExUUm1Zamt0WVRrMFppMHdOelE1WmpVd05qTTFOamdsTWpJbE4wUSUzRCIsInIiOmZhbHNlfSwiaSI6eyJpIjoiZjY1NTliZGMtYjM5ZS00ZmI5LWE5NGYtMDc0OWY1MDYzNTY4In19',
    'unleash (tsm)': 'https://tsm-unleash-web.iap.nav.cloud.nais.io/',
    ida: 'https://ida.intern.nav.no/',
    flexjar: 'https://flexjar.ansatt.nav.no/',
    amplitude: 'https://app.eu.amplitude.com/analytics/nav/space/e-i94ld6q/',
}

const availablePages = {
    ...staticPages,
    ...{ ...(isKnowit ? knowitPages : {}) },
    ...hiddenPages,
}

type PageKeys = (typeof pageKeys)[number]
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const pageKeys = R.keys(staticPages)

const availableApps = {
    sykmeldinger: {
        dev: 'https://www.ekstern.dev.nav.no/syk/sykmeldinger',
        demo: 'https://sykmeldinger.ekstern.dev.nav.no/syk/sykmeldinger',
        prod: 'https://www.nav.no/syk/sykmeldinger',
    } satisfies Envs,
    dinesykmeldte: {
        dev: 'https://www.ekstern.dev.nav.no/arbeidsgiver/sykmeldte',
        demo: 'https://dinesykmeldte.ekstern.dev.nav.no/arbeidsgiver/sykmeldte',
        prod: 'https://www.nav.no/arbeidsgiver/sykmeldte',
    } satisfies Envs,
    'syk-dig': {
        dev: 'https://syk-dig.intern.dev.nav.no',
        demo: 'https://syk-dig.ekstern.dev.nav.no/',
        prod: 'https://syk-dig.intern.nav.no/',
    } satisfies Envs,
    'syk-inn': {
        dev: 'https://www.ekstern.dev.nav.no/samarbeidspartner/sykmelding',
        demo: 'https://syk-inn.ekstern.dev.nav.no/samarbeidspartner/sykmelding',
        prod: 'https://nav.no/samarbeidspartner/sykmelding/',
    } satisfies Envs,
    'sykmelder-statistikk': {
        dev: 'https://www.ekstern.dev.nav.no/samarbeidspartner/sykmelder-statistikk',
        demo: 'https://sykmelder-statistikk.ekstern.dev.nav.no/samarbeidspartner/sykmelder-statistikk',
        prod: 'https://www.nav.no/samarbeidspartner/sykmelder-statistikk',
    } satisfies Envs,
    smregistrering: {
        dev: 'https://smregistrering.intern.dev.nav.no/',
        demo: 'https://smregistrering.ekstern.dev.nav.no/?oppgaveid=123',
        prod: 'https://smregistrering.intern.nav.no/',
    } satisfies Envs,
    syfosmmanuell: {
        dev: 'https://syfosmmanuell.intern.dev.nav.no/',
        demo: 'https://syfosmmanuell.ekstern.dev.nav.no/?oppgaveid=123',
        prod: 'https://syfosmmanuell.intern.nav.no/',
    } satisfies Envs,
}

type AppKeys = keyof typeof availableApps

export async function openResource(what: string | null, env: string | null): Promise<void> {
    if (what != null && isPage(what)) {
        await openUrl(availablePages[what])
        return
    }

    if (what != null && isApp(what)) {
        const selectedEnv = (env as keyof Envs) ?? (await getAppEnv(what))
        await openApp(what, selectedEnv)
        return
    }

    const everything = [
        ...R.difference(R.keys(availablePages), R.keys(hiddenPages)),
        ...R.keys(availableApps).map((it) => `app: ${it}`),
    ]

    const initialFilteredValues = everything.filter((page) => page.includes(what ?? ''))
    // If the initial input only yields a single hit, just open it
    if (initialFilteredValues.length === 1) {
        await openAppOrPage(initialFilteredValues[0])
        return
    }

    const selectedRootItem = await search({
        message: 'What do you want to open?',
        source: (term) =>
            everything
                .filter((page) => page.includes(term ?? what ?? ''))
                .map((it) => ({
                    name: it,
                    value: it,
                })),
    })

    await openAppOrPage(selectedRootItem)
}

async function openAppOrPage(appOrPage: string): Promise<void> {
    const cleanItem = appOrPage.replace('app: ', '')

    if (!isApp(cleanItem)) {
        const staticPage = availablePages[cleanItem as PageKeys]

        await openUrl(staticPage)
        return
    }

    const selectedEnv = await getAppEnv(cleanItem)

    await openApp(cleanItem, selectedEnv)
}

async function openApp(app: AppKeys, env: keyof Envs): Promise<void> {
    const url = availableApps[app][env]

    log(`Opening ${chalk.blue(url)}...`)
    await openUrl(url)
}

async function getAppEnv(app: AppKeys): Promise<keyof Envs> {
    const envs = availableApps[app]
    const selectedEnv = await search({
        message: `What environment for ${app} do you want to open?`,
        source: (term) => R.keys(envs).filter((page) => page.includes(term ?? '')),
    })

    return selectedEnv as keyof Envs
}

function isPage(what: string): what is PageKeys {
    return what in availablePages
}

function isApp(what: string): what is AppKeys {
    return what in availableApps
}
