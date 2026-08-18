import * as clack from '@clack/prompts'
import chalk, { backgroundColorNames, foregroundColorNames } from 'chalk'

type Level = 'log' | 'error'

/**
 * Where log output is written:
 *
 * - `plain`: straight to console, the classic tsm output
 * - `clack`: through @clack/prompts, so output lines up with intro/outro/spinners
 *
 * Commands opt in to `clack` through `tuiSession` in `tui.ts`.
 */
type LogSink = 'plain' | 'clack'

let sink: LogSink = 'plain'
let buffer: { level: Level; message: string }[] | null = null

export const setLogSink = (next: LogSink): void => {
    sink = next
}

/**
 * Buffers all log output instead of writing it. Used while a spinner owns the last line of the
 * terminal, since any foreign write corrupts the spinner frame.
 */
export const startBufferingLogs = (): void => {
    buffer = []
}

export const flushBufferedLogs = (): void => {
    const buffered = buffer ?? []
    buffer = null
    buffered.forEach(({ level, message }) => write(level, message))
}

function format(args: unknown[]): string {
    return args.map((it) => (typeof it === 'string' ? it : Bun.inspect(it))).join(' ')
}

function write(level: Level, message: string): void {
    if (sink === 'clack') {
        if (level === 'error') {
            clack.log.error(message)
        } else {
            clack.log.message(message)
        }
        return
    }

    if (level === 'error') {
        // eslint-disable-next-line no-console
        console.error(message)
    } else {
        // eslint-disable-next-line no-console
        console.log(message)
    }
}

function emit(level: Level, args: unknown[]): void {
    const message = format(args)

    if (buffer != null) {
        buffer.push({ level, message })
        return
    }

    write(level, message)
}

export const log = (...args: unknown[]): void => emit('log', args)

export const logError = (...args: unknown[]): void => emit('error', args)

export const logNoNewLine = (message: string): void => {
    if (buffer != null || sink === 'clack') {
        emit('log', [message])
        return
    }

    process.stdout.write(message)
}

export const logProgressDot = (): void => {
    // Progress dots write mid-line, which corrupts spinners and the clack gutter.
    if (buffer != null || sink === 'clack') return

    const color = foregroundColorNames[Math.floor(Math.random() * foregroundColorNames.length)]
    const bgColor = backgroundColorNames[Math.floor(Math.random() * backgroundColorNames.length)]
    process.stdout.write(chalk[bgColor][color]('.'))
}
