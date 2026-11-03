// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Reads the engine's model download stream: text lines ending with one `DOWNLOAD_RESULT {"ok": …}`
 * line (`DOWNLOAD_RESULT_PREFIX` in `workers/engines/multiserve/modules/utils.py`). Success is
 * decided by that line alone, as progress text may say "error" in a model or file name; a stream
 * without it was cut off.
 */

const DOWNLOAD_RESULT_PREFIX = 'DOWNLOAD_RESULT '

interface DownloadResult {
  ok: boolean
  error?: string
}

function parseResult(text: string): DownloadResult {
  try {
    const value = JSON.parse(text) as { ok?: unknown; error?: unknown }
    return {
      ok: value.ok === true,
      ...(typeof value.error === 'string' ? { error: value.error } : {}),
    }
  } catch {
    return { ok: false, error: `Unreadable download result: ${text}` }
  }
}

/**
 * Reads `body` to its end, handing every non-empty line to `onLine` (with
 * the parsed result for the result line), and resolves with that result.
 */
export async function readDownloadStream(
  body: ReadableStream<Uint8Array>,
  onLine: (line: string, result?: DownloadResult) => void,
): Promise<DownloadResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let result: DownloadResult | null = null

  const take = (line: string) => {
    const text = line.trim()
    if (!text) return
    if (text.startsWith(DOWNLOAD_RESULT_PREFIX)) {
      const parsed = parseResult(text.slice(DOWNLOAD_RESULT_PREFIX.length))
      result = parsed
      onLine(text, parsed)
      return
    }
    onLine(text)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      const lines = pending.split(/\r\n|\r|\n/)
      pending = lines.pop() ?? ''
      lines.forEach(take)
    }
    pending += decoder.decode()
    take(pending)
  } finally {
    reader.releaseLock()
  }

  return (
    result ?? {
      ok: false,
      error: 'The download stream ended without a result',
    }
  )
}
