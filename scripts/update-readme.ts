// oxlint-disable no-console

import { getYargsParser } from '../src/yargs-parser'

const availableCommands = await Promise.all(
    (await getYargsParser(['foo', 'bar']).getCompletion([]))
        .map((it) => it.split(/:(.+)/))
        .map(async ([name, description]) => [name, description]),
)

const readmeMarkersRegex =
    /<!-- COMPUTER SAYS DON'T TOUCH THIS START -->[\s\S]*?<!-- COMPUTER SAYS DON'T TOUCH THIS END -->/g

const readmeFile = Bun.file(import.meta.dir + '/../README.md')
const originalFileContent = await readmeFile.text()
const newContent = `<!-- COMPUTER SAYS DON'T TOUCH THIS START -->

${availableCommands.map(([name, description]) => `* \`${name}\` - ${description}`).join('\n')}

<!-- COMPUTER SAYS DON'T TOUCH THIS END -->`

await Bun.write(readmeFile, originalFileContent.replace(readmeMarkersRegex, newContent))

console.info('Updated README.md with --help output')
