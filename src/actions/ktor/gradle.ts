import path from 'node:path'

import { GIT_CACHE_DIR } from '../../common/cache.ts'

export type GradleResult = { ok: true } | { ok: false; output: string }

/**
 * Runs `./gradlew clean build test` in the repo's cached checkout.
 */
export async function gradleBuild(repo: string): Promise<GradleResult> {
    const proc = Bun.spawn(['./gradlew', 'clean', 'build', 'test'], {
        cwd: path.join(GIT_CACHE_DIR, repo),
        stdout: 'pipe',
        stderr: 'pipe',
    })

    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])

    if (exitCode === 0) {
        return { ok: true }
    }

    return { ok: false, output: lastLines(`${stdout}\n${stderr}`, 20) }
}

function lastLines(output: string, count: number): string {
    return output.trim().split('\n').slice(-count).join('\n').trim()
}
