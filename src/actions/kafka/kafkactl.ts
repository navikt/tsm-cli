import yaml from 'js-yaml'
import chalk from 'chalk'
import fs from 'fs-extra'

import { log } from '../../common/log.ts'

const expectedPath = `${Bun.env.HOME}/.config/kafkactl/config.yml`

type KafkactlConfig = {
    contexts: Record<string, unknown>
    'current-context': string
}

/**
 * A kafkactl context looks like this:
 * context-name:
 *   brokers:
 *     - kafka-broker-host:26484
 *   tls:
 *     enabled: true
 *     ca: KAFKA_CA
 *     cert: KAFKA_CERTIFICATE
 *     certKey: KAFKA_PRIVATE_KEY
 *     insecure: true
 *
 *  Under the root level "contexts" key. If the config file is found, we'll add it.
 */
export async function tryAddContextToKafkactl(app: string, secretPath: string): Promise<void> {
    const config = Bun.file(expectedPath)
    if (!(await config.exists())) {
        log(chalk.yellow(`Debug: Found no kafkactl config at ${expectedPath}, skipping context addition`))
        return
    }

    const kafkaBrokers = fs.readFileSync(`${secretPath}/KAFKA_BROKERS`, 'utf-8').trim()
    const configYaml = yaml.load(await config.text()) as KafkactlConfig

    delete configYaml.contexts[app]
    configYaml.contexts[app] = {
        brokers: kafkaBrokers,
        tls: {
            enabled: true,
            insecure: true,
            ca: `${secretPath}/KAFKA_CA`,
            cert: `${secretPath}/KAFKA_CERTIFICATE`,
            certKey: `${secretPath}/KAFKA_PRIVATE_KEY`,
        },
    }
    configYaml['current-context'] = app

    const updatedYaml = yaml.dump(configYaml)

    await config.write(updatedYaml)

    log(`\nBonus:${chalk.green(`\nAdded ${chalk.blue(app)} context to ${chalk.bgCyan.black('kafkactl')}`)}`)
}
