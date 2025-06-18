// TODO don't disable eslint? :D
/* eslint-disable */
import fs from 'fs-extra'

import { CACHE_DIR } from '../../common/cache.ts'
import { log } from '../../common/log.ts'
import { getAllAppNames, promptForAppName } from '../../common/kubectl.ts'
import chalk from 'chalk'
import { tryAddContextToKafkactl } from './kafkactl.ts'

function saveSecretToPath(secretData: any, path: string): void {
    Object.keys(secretData).forEach((key) => {
        // Decode from base64 and save to path
        const decodedValue = Buffer.from(secretData[key], 'base64')
        fs.outputFileSync(`${path}/${key}`, decodedValue)
    })
}

function getAndSaveSecret(secretName: string, path: string) {
    const output = Bun.spawnSync(`kubectl get secret ${secretName} -o json`.split(' '))
    if (output.exitCode !== 0) {
        console.error(`Failed to get secret ${secretName}: ${output.stderr}`)
        return
    }

    const secretData = JSON.parse(output.stdout.toString()).data
    saveSecretToPath(secretData, path)
}

function saveKafkaCatConfig(secretPath: string, configFile: string) {
    const kafkaBrokers = fs.readFileSync(`${secretPath}/KAFKA_BROKERS`, 'utf-8').trim()
    fs.removeSync(configFile)
    const writeStream = fs.createWriteStream(configFile, { flags: 'a' })
    writeStream.write(`ssl.ca.location=${secretPath}/KAFKA_CA\n`)
    writeStream.write(`ssl.key.location=${secretPath}/KAFKA_PRIVATE_KEY\n`)
    writeStream.write(`ssl.certificate.location=${secretPath}/KAFKA_CERTIFICATE\n`)
    writeStream.write(`bootstrap.servers=${kafkaBrokers}\n`)
    writeStream.write('security.protocol=ssl\n')
    writeStream.write('enable.ssl.certificate.verification=false\n')
    writeStream.end()
}

function saveJavaConfig(secretPath: string, configFile: string) {
    const kafkaBrokers = fs.readFileSync(`${secretPath}/KAFKA_BROKERS`, 'utf-8').trim()
    const kredstorePassword = fs.readFileSync(`${secretPath}/KAFKA_CREDSTORE_PASSWORD`, 'utf-8').trim()
    fs.removeSync(configFile)
    const writeStream = fs.createWriteStream(configFile, { flags: 'a' })
    writeStream.write(`bootstrap.servers=${kafkaBrokers}\n`)
    writeStream.write('security.protocol=ssl\n')
    writeStream.write('ssl.keystore.type=PKCS12\n')
    writeStream.write('ssl.endpoint.identification.algorithm=\n')
    writeStream.write(`ssl.truststore.location=${secretPath}/client.truststore.jks\n`)
    writeStream.write(`ssl.keystore.location=${secretPath}/client.keystore.p12\n`)
    writeStream.write(`ssl.truststore.password=${kredstorePassword}\n`)
    writeStream.write(`ssl.keystore.password=${kredstorePassword}\n`)

    writeStream.end()
}

function saveSpringBootConfig(secretPath: string, configFile: string) {
    const kafkaBrokers = fs.readFileSync(`${secretPath}/KAFKA_BROKERS`, 'utf-8').trim()
    const kredstorePassword = fs.readFileSync(`${secretPath}/KAFKA_CREDSTORE_PASSWORD`, 'utf-8').trim()
    fs.removeSync(configFile)
    const writeStream = fs.createWriteStream(configFile, { flags: 'a' })

    writeStream.write(`# Put this file in your resources folder, and start the spring boot server with the additional profile: dev-kafka
spring:
  kafka:
    bootstrap-servers: ${kafkaBrokers}
    security:
      protocol: ssl
    ssl:
      key-store-type: PKCS12
      trust-store-location: file:${secretPath}/client.truststore.jks
      key-store-location: file:${secretPath}/client.keystore.p12
      trust-store-password: ${kredstorePassword}
      key-store-password: ${kredstorePassword}
`)
    writeStream.end()
}
export async function kafkaConfig(appname: string | undefined | null): Promise<void> {
    const context = Bun.spawnSync('kubectl config current-context'.split(' ')).stdout.toString().trim()
    const podListProc = Bun.spawn('kubectl get pods -l kafka=enabled -o json'.split(' '), {
        stdout: 'pipe',
    })
    const stdoutArray: Uint8Array[] = await Bun.readableStreamToArray(podListProc.stdout)
    const podList = stdoutArray.map((it) => new TextDecoder().decode(it)).join('')

    const pods = JSON.parse(podList).items
    const appsAndPods = getAllAppNames(pods)
    const { appName, pod } = await promptForAppName(appsAndPods, appname)

    if (pods.length === 0) {
        console.error(`No pods found for app ${appname}`)
        return
    }

    const secretVolumes = pod.spec.volumes
        .filter((volume: any) => volume.name == 'aiven-credentials')
        .map((volume: any) => volume.secret.secretName)
    const aivenSecret = secretVolumes[0]
    const basePath = `${CACHE_DIR}/${context}/${appName}`
    const secretPath = `${basePath}/.secrets`
    getAndSaveSecret(aivenSecret, secretPath)
    saveKafkaCatConfig(`${secretPath}`, `${basePath}/kcat.config`)
    saveJavaConfig(`${secretPath}`, `${basePath}/kafka.config`)
    saveSpringBootConfig(`${secretPath}`, `${basePath}/application-dev-kafka.yaml`)
    log(`\nbootstrap.servers: ${chalk.green(fs.readFileSync(`${secretPath}/KAFKA_BROKERS`, 'utf-8').trim())}`)
    log(`\nSaved kcat config:\n${chalk.bgCyan.black(`${basePath}/kcat.config`)}`)
    log(`\nSaved kafka config:\n${chalk.bgYellow.black(`${basePath}/kafka.config`)}`)
    log(`\nSaved Spring Boot config:\n${chalk.bgGreen.black(`${basePath}/application-dev-kafka.yaml`)}`)

    await tryAddContextToKafkactl(appName, secretPath)
}

export async function cleanup() {
    fs.removeSync(`${CACHE_DIR}/dev-gcp`)
    fs.removeSync(`${CACHE_DIR}/prod-gcp`)
    log(`Removed all kafka files`)
}
