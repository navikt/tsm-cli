import yaml from 'js-yaml'
import chalk from 'chalk'
import fs from 'fs-extra'

import { log } from '../../common/log.ts'

const KAFKACTL_PATH = `${Bun.env.HOME}/.config/kafkactl/config.yml`

type KafkactlConfig = {
    contexts: Record<string, unknown>
    'current-context': string
}

export async function tryAddAddContextToKafkactl(app: string, context: string, secretPath: string): Promise<void> {
    const config = Bun.file(KAFKACTL_PATH)
    if (!(await config.exists())) {
        return
    }

    const kafkaBrokers = fs.readFileSync(`${secretPath}/KAFKA_BROKERS`, 'utf-8').trim()

    const contextKey = `${app}-${context}`

    try {
        await updateKafkactlConfig(contextKey, {
            brokers: kafkaBrokers,
            ca: `${secretPath}/KAFKA_CA`,
            cert: `${secretPath}/KAFKA_CERTIFICATE`,
            certKey: `${secretPath}/KAFKA_PRIVATE_KEY`,
        })
    } catch {
        // Squelch
    }
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
export async function updateKafkactlConfig(
    contextName: string,
    values: {
        brokers: string
        ca: string
        cert: string
        certKey: string
    },
): Promise<void> {
    const config = Bun.file(KAFKACTL_PATH)
    if (!(await config.exists())) {
        throw new Error(
            `kafkactl config file not found at ${KAFKACTL_PATH}. Skipping adding context ${contextName} to kafkactl config.`,
        )
    }

    const configYaml = yaml.load(await config.text()) as KafkactlConfig
    delete configYaml.contexts[contextName]
    configYaml.contexts[contextName] = {
        brokers: values.brokers,
        tls: {
            enabled: true,
            insecure: true,
            ca: values.ca,
            cert: values.cert,
            certKey: values.certKey,
        },
    }

    const updatedYaml = yaml.dump(configYaml)
    await config.write(updatedYaml)

    log(
        `${chalk.green(`\nAdded ${chalk.blue(contextName)} context to ${chalk.bgCyan.black('kafkactl')}`)}, run ${chalk.grey(`kafkactl config use-context ${contextName}`)}`,
    )
}
