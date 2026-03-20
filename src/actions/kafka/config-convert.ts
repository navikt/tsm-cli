import * as R from 'remeda'

import { logError } from '../../common/log.ts'

import { updateKafkactlConfig } from './kafkactl.ts'

export async function convertKcatToKafkaCtl(path: string): Promise<void> {
    const bunFile = Bun.file(path)
    if (!(await bunFile.exists())) {
        logError(`File ${path} does not exist.`)
        return
    }

    const content = await bunFile.text()
    const config: Record<string, string> = R.pipe(
        content.split('\n'),
        R.filter((it) => it.includes('=') && !it.startsWith('#')),
        R.map((it) => it.split('=', 2).map((s) => s.trim()) as [string, string]),
        R.fromEntries(),
    )

    const env = config['bootstrap.servers'].includes('nav-prod') ? 'prod' : 'dev'
    await updateKafkactlConfig(`nais-${env}`, {
        brokers: config['bootstrap.servers'],
        ca: config['ssl.ca.location'],
        cert: config['ssl.certificate.location'],
        certKey: config['ssl.key.location'],
    })
}
