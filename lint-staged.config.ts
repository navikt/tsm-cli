import type { Configuration } from 'lint-staged'

const config: Configuration = {
    '*': () => 'bun run fmt --no-error-on-unmatched-pattern',
    '*.{ts,tsx,js,ts,mjs,mts}': 'bun run lint --fix --max-warnings=0',
    '*.{ts,tsx}': () => 'bun run tsc',
}

export default config
