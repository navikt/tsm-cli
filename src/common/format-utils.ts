import chalk, { backgroundColorNames } from 'chalk'
import crypto from 'crypto'

export function authorToColorAvatar(username: string): string {
    const hash = crypto.createHash('md5').update(username).digest('hex').slice(-6)
    const index = parseInt(hash, 16) % backgroundColorNames.length

    return chalk[backgroundColorNames[index]]('  ')
}
