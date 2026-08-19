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
