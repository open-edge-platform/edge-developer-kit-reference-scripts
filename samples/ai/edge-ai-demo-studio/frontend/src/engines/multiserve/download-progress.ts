// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Follows a model download's stream (`./download-stream.ts`) during a start: progress for the
 * startup panel, lines for the instance log. Each file is its own step, since its progress starts
 * over. Progress lines are logged once per tenth, or every half minute without a total. llama.cpp
 * (`gguf_downloader.py`) prints a total of `0.00 GB` when the hub did not say.
 */

import type { StartupEvent } from '@/lib/workers/startup-events'

const UNKNOWN_TOTAL_LOG_INTERVAL_MS = 30_000

// Both backends count in 1024s, whatever the unit is called.
const UNIT_POWER: Record<string, number> = {
  B: 0,
  KB: 1,
  KIB: 1,
  MB: 2,
  MIB: 2,
  GB: 3,
  GIB: 3,
  TB: 4,
  TIB: 4,
}

const GGUF_PROGRESS =
  /^Progress \((\d+)\/(\d+) (.+)\): ([\d.]+) GB \/ ([\d.]+) GB\b/
const OVMS_FILE = /^Downloading lfs size: [\d.]+ \w+ file: (.+)$/
const OVMS_PROGRESS = /^Progress: \[[^\]]*\]\s*([\d.]+)% of ([\d.]+) (\w+)/

type DownloadLine =
  /** OVMS starts a file; its size comes with its progress lines. */
  | { kind: 'file'; name: string }
  /** Bytes of the current file; llama.cpp names the file on every line. */
  | {
      kind: 'progress'
      current: number
      total?: number
      file?: { name: string; index: number; count: number }
    }

function toBytes(value: string, unit: string): number | undefined {
  const power = UNIT_POWER[unit.toUpperCase()]
  const amount = Number(value)
  if (power === undefined || !Number.isFinite(amount)) return undefined
  return Math.round(amount * 1024 ** power)
}

/** OVMS may name a file by its path: the last part is enough. */
function baseName(file: string): string {
  const name = file.trim()
  return name.split(/[\\/]/).filter(Boolean).pop() ?? name
}

/** What a line says about the download's progress; `null` for any other line. */
function parseDownloadLine(line: string): DownloadLine | null {
  const gguf = GGUF_PROGRESS.exec(line)
  if (gguf) {
    const [, index, count, name, current, total] = gguf
    const currentBytes = toBytes(current, 'GB')
    const totalBytes = toBytes(total, 'GB')
    if (currentBytes === undefined) return null
    return {
      kind: 'progress',
      current: currentBytes,
      ...(totalBytes !== undefined && totalBytes > 0 && { total: totalBytes }),
      file: {
        name: baseName(name),
        index: Number(index),
        count: Number(count),
      },
    }
  }

  const file = OVMS_FILE.exec(line)
  if (file) return { kind: 'file', name: baseName(file[1]) }

  const ovms = OVMS_PROGRESS.exec(line)
  if (ovms) {
    const [, percent, total, unit] = ovms
    const totalBytes = toBytes(total, unit)
    const share = Number(percent)
    if (totalBytes === undefined || !Number.isFinite(share)) return null
    return {
      kind: 'progress',
      current: Math.round((totalBytes * Math.min(share, 100)) / 100),
      ...(totalBytes > 0 && { total: totalBytes }),
    }
  }
  return null
}

/**
 * Follows one download of `model`: `report` gets each file as a step and
 * its progress, `log` the lines worth keeping. Takes every line of the
 * stream but its result line.
 */
export function followDownload(
  model: string,
  {
    report,
    log,
    now = Date.now,
  }: {
    report: (event: StartupEvent) => void
    log: (line: string) => void
    now?: () => number
  },
): (line: string) => void {
  let fileKey: string | undefined
  let ovmsFiles = 0
  let loggedTenth = -1
  let loggedAt: number | undefined

  const startFile = (key: string, label: string) => {
    fileKey = key
    loggedTenth = -1
    loggedAt = undefined
    report({
      type: 'stage',
      stage: 'downloading',
      detail: `${model} · ${label}`,
    })
  }

  const worthLogging = (current: number, total: number | undefined) => {
    if (total !== undefined) {
      const tenth = Math.floor(Math.min(current / total, 1) * 10)
      if (tenth <= loggedTenth) return false
      loggedTenth = tenth
      return true
    }
    const at = now()
    if (
      loggedAt !== undefined &&
      at - loggedAt < UNKNOWN_TOTAL_LOG_INTERVAL_MS
    ) {
      return false
    }
    loggedAt = at
    return true
  }

  return (line) => {
    const parsed = parseDownloadLine(line)
    if (!parsed) {
      log(line)
      return
    }
    if (parsed.kind === 'file') {
      // Two files may share a name in different folders: each line is a new one.
      ovmsFiles += 1
      startFile(`ovms:${ovmsFiles}`, parsed.name)
      return
    }

    const { file } = parsed
    if (file) {
      const key = `${file.index}/${file.count} ${file.name}`
      if (key !== fileKey) {
        startFile(
          key,
          file.count > 1
            ? `${file.name} (${file.index} of ${file.count})`
            : file.name,
        )
      }
    }
    report({
      type: 'progress',
      stage: 'downloading',
      current: parsed.current,
      ...(parsed.total !== undefined && { total: parsed.total }),
      unit: 'bytes',
    })
    if (worthLogging(parsed.current, parsed.total)) log(line)
  }
}
