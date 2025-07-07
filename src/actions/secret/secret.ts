import chalk from 'chalk'
import { search } from '@inquirer/prompts'

import { log } from '../../common/log.ts'

export async function getSecret(secretName: string | undefined | null): Promise<void> {
    const secretList = Bun.spawn(['kubectl', 'get', 'secrets'])
    const stdoutArray = await Bun.readableStreamToArray(secretList.stdout)
    const secretOutput = Buffer.concat(stdoutArray).toString()

    const secretNames = secretOutput
        .split('\n')
        .slice(1)
        .map((line) => line.trim().split(/\s+/)[0])
        .filter((name) => name.length > 0)

    const secret = await promtForSecretName(secretNames, secretName)
    const secretRaw = Bun.spawnSync(['kubectl', 'get', 'secret', secret, '-o', 'json'])

    const outputStr = new TextDecoder().decode(secretRaw.stdout)
    const json = JSON.parse(outputStr)
    const data = json.data

    for (const [key, val] of Object.entries(data)) {
        const value = (val as string).length > 200 ? '...' : Buffer.from(val as string, 'base64').toString('utf8')
        log(`${chalk.cyan(key)}: ${chalk.green(value)}`)
    }
}

export async function promtForSecretName(secrets: string[], secretName: string | undefined | null): Promise<string> {
    const namesAndDates = new Map<string, string>()
    const dateRegex = /^(.*?)(-[0-9]+)+$/
    secrets.forEach((key) => {
        const nameAndDate = key.match(dateRegex)
        if (nameAndDate) {
            const name = nameAndDate[1]
            const current = namesAndDates.get(name)
            if (current === undefined || key > current) {
                namesAndDates.set(name, key)
            }
        } else {
            namesAndDates.set(key, key)
        }
    })

    const secretsLIstInput = Array.from(namesAndDates.values())

    const secretInput = secretName || ''
    return search({
        message: 'Start typing to search for an secret',
        source: (term) => {
            return secretsLIstInput
                .filter((secret) => secret.includes(term ?? secretInput))
                .map((secret) => ({
                    name: secret,
                    value: secret,
                }))
        },
    })
}
