import * as clack from '@clack/prompts'

import { flushBufferedLogs, setLogSink, startBufferingLogs } from './log.ts'

type Spinner = ReturnType<typeof clack.spinner>

/**
 * Runs a command as a clack session, meaning all log output is routed through clack and framed
 * by an intro/outro.
 */
export async function tuiSession<T>(title: string, fn: () => Promise<T>): Promise<T> {
    setLogSink('clack')
    clack.intro(title)

    try {
        const result = await fn()
        clack.outro('Done')

        return result
    } catch (e) {
        clack.log.error(e instanceof Error ? e.message : String(e))
        clack.outro('Failed')
        throw e
    } finally {
        setLogSink('plain')
    }
}

/**
 * Runs `fn` while a spinner is showing. Log output from anywhere in the call tree is buffered
 * while the spinner is live, and flushed once it stops, since writing to stdout corrupts the
 * spinner frame.
 */
export async function withSpinner<T>(
    startMessage: string,
    fn: (spinner: Spinner) => Promise<T>,
    stopMessage?: (result: T) => string,
): Promise<T> {
    const spinner = clack.spinner()

    startBufferingLogs()
    spinner.start(startMessage)

    try {
        const result = await fn(spinner)
        spinner.stop(stopMessage?.(result) ?? startMessage)

        return result
    } catch (e) {
        spinner.stop(startMessage)
        throw e
    } finally {
        flushBufferedLogs()
    }
}
