import config from '@navikt/tsm-oxfmt'
import { defineConfig } from 'oxfmt'

export default defineConfig({
    ...config,
    ignorePatterns: ['tsm-cli/package.json'],
})
