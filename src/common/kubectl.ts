import { $ } from 'bun'
import chalk from 'chalk'
import { search } from '@inquirer/prompts'

import { log } from './log.ts'

// eslint-disable-next-line
export function getAllAppNames(pods: any[]): Map<string, any[]> {
    // eslint-disable-next-line
    const appPodMap = new Map<string, any>()
    pods.forEach((pod) => {
        const appName = pod.metadata.labels.app
        if (appName && !appPodMap.has(appName)) {
            appPodMap.set(appName, pod)
        }
    })
    return appPodMap
}

// eslint-disable-next-line
export async function promptForAppName(appPodMap: Map<string, any>, appname: string | undefined | null) {
    const appNames: string[] = Array.from(appPodMap.keys())
    if (appname != null && appNames.includes(appname)) {
        log(`→ Using app: ${chalk.green(appname)}`)
        return {
            appName: appname,
            pod: appPodMap.get(appname),
        }
    }

    const appInput = appname || ''
    const appName = await search({
        message: 'Start typing to search for an app',
        source: (term) => {
            return appNames
                .filter((app) => app.includes(term ?? appInput))
                .map((app) => ({
                    name: app,
                    value: app,
                }))
        },
    })

    return {
        appName,
        pod: appPodMap.get(appName),
    }
}

export async function changeContext(namespace: string, cluster: 'dev-gcp' | 'prod-gcp'): Promise<void> {
    const clusterOutput = await $`kubectl config use-context ${cluster}`.quiet()
    const namespaceOutput = await $`kubectl config set-context --current --namespace=${namespace}`.quiet()

    if (clusterOutput.exitCode === 0) {
        log(`→ Cluster set to ${chalk.green(cluster)}`)
    } else {
        log(chalk.red(`Failed to set cluster: ${clusterOutput.stderr.toString()}`))
    }

    if (namespaceOutput.exitCode === 0) {
        log(`→ Namespace set to ${chalk.green(namespace)}`)
    } else {
        log(chalk.red(`Failed to set namespace: ${namespaceOutput.stderr.toString()}`))
    }
}
