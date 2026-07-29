import fs from 'node:fs'
import path from 'node:path'

export const CACHE_DIR = path.join(Bun.env.HOME ?? '~', '.cache', 'tsm')
export const GIT_CACHE_DIR = path.join(CACHE_DIR, 'repos')

// Dumbly just create the cache dir, we don't care
fs.mkdirSync(CACHE_DIR, { recursive: true })
