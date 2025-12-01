import { $ } from 'bun'

export const distrolessBumpTypes = ['java21', 'node24'] as const

export type DistrolessBumpTypes = (typeof distrolessBumpTypes)[number]

export async function getLatestDigestHash(type: DistrolessBumpTypes): Promise<{ digest: string; image: string }> {
    const image = typeToImage(type)
    const output = await $`docker manifest inspect --verbose ${image}:latest`.quiet().throws(true).json()

    let digest: string | null
    if (Array.isArray(output)) {
        digest = output.find((it) => it.Descriptor.platform.architecture === 'amd64').Descriptor.digest ?? null
    } else {
        digest = output.Descriptor.digest ?? null
    }

    if (digest == null) {
        throw new Error(`No manifest found: ${process.stderr?.toString() ?? 'No error'}`)
    }

    return { digest, image }
}

function typeToImage(type: DistrolessBumpTypes): string {
    switch (type) {
        case 'java21':
            return 'gcr.io/distroless/java21-debian12'
        case 'node24':
            return 'gcr.io/distroless/nodejs24-debian12'
    }
}
