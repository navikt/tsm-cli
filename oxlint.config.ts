import tsmBase from '@navikt/tsm-oxlint'
import { defineConfig } from 'oxlint'

export default defineConfig({
    extends: [tsmBase],
    options: { typeCheck: true, typeAware: true },
    rules: {
        // TODO: Consider turning on
        'typescript/no-misused-spread': 'off',
    },
})
