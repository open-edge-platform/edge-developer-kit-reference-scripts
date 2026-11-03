// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process'
import { withLoopbackNoProxy } from '@/lib/workers/spawn-env'

/** Short-lived commands with collected output; long-lived workers use `lib/workers/process-handler`. */

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

/** Why `runCommand` stopped a command before it exited on its own. */
export class CommandInterruptedError extends Error {
  readonly reason: 'timeout' | 'aborted'

  constructor(command: string, reason: 'timeout' | 'aborted', ms?: number) {
    super(
      reason === 'timeout'
        ? `${command} timed out after ${ms} ms`
        : `${command} was cancelled`,
    )
    this.name = 'CommandInterruptedError'
    this.reason = reason
  }
}

export interface RunCommandOptions {
  cwd?: string
  /** Defaults to this process's environment; loopback hosts are always kept off any proxy. */
  env?: NodeJS.ProcessEnv
  /** Kills the command and rejects with a `timeout` `CommandInterruptedError`; `null` waits forever. */
  timeoutMs?: number | null
  /** Aborting kills the command and rejects with an `aborted` `CommandInterruptedError`. */
  signal?: AbortSignal
  /** Each complete line of output, as it is printed. */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Runs `command` without a shell and resolves with its output and exit code (non-zero is not an
 * error). Rejects when it cannot start (e.g. `ENOENT`), times out or is aborted.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  {
    cwd,
    env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    onLine,
  }: RunCommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CommandInterruptedError(command, 'aborted'))
      return
    }

    const proc = spawn(/* turbopackIgnore: true */ command, [...args], {
      cwd,
      env: withLoopbackNoProxy(env ?? process.env),
      shell: false,
      windowsHide: true,
    })

    const output = { stdout: '', stderr: '' }
    const pending = { stdout: '', stderr: '' }
    const collect = (stream: 'stdout' | 'stderr', chunk: string) => {
      output[stream] += chunk
      if (!onLine) return
      const lines = (pending[stream] + chunk).split(/\r?\n/)
      pending[stream] = lines.pop() ?? ''
      for (const line of lines) onLine(line, stream)
    }
    proc.stdout?.on('data', (data) => collect('stdout', data.toString()))
    proc.stderr?.on('data', (data) => collect('stderr', data.toString()))

    let settled = false
    const stop = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      proc.kill('SIGTERM')
      reject(error)
    }
    const onAbort = () => stop(new CommandInterruptedError(command, 'aborted'))
    const timer =
      timeoutMs == null
        ? undefined
        : setTimeout(
            () =>
              stop(new CommandInterruptedError(command, 'timeout', timeoutMs)),
            timeoutMs,
          )
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    proc.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
    proc.on('close', (exitCode) => {
      if (settled) return
      settled = true
      cleanup()
      if (onLine) {
        for (const stream of ['stdout', 'stderr'] as const) {
          if (pending[stream]) onLine(pending[stream], stream)
        }
      }
      resolve({ ...output, exitCode })
    })
  })
}

/** Whether `error` is Node's "command not found" spawn failure. */
export function isCommandMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
