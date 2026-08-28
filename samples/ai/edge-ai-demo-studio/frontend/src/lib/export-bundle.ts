// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WORKER_DIR } from '@/lib/constants'
import { logger } from '@/lib/logger'

// The export tooling lives at <repo-root>/scripts/export-bundle.mjs. WORKER_DIR
// is <repo-root>/workers, so the repo root is one level up — this mirrors how
// the rest of the app resolves project paths (see lib/constants.ts).
const REPO_ROOT = path.resolve(WORKER_DIR, '..')
const EXPORT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'export-bundle.mjs')

// Sample/service ids are folder names; keep the allow-list strict so nothing
// resembling a flag (e.g. `--out`) can be smuggled in as an id.
const ENTITY_ID_RE = /^[a-z0-9][a-z0-9-]*$/

const PLAN_TIMEOUT_MS = 30_000
const EXPORT_TIMEOUT_MS = 5 * 60_000

export interface ExportSampleSummary {
  id: string
  deps: { serviceId: string; role: 'required' | 'optional' }[]
}

export interface ExportPlan {
  samples: ExportSampleSummary[]
  /** Service ids the caller asked for directly (not derived from samples). */
  requestedServices: string[]
  services: { required: string[]; optional: string[]; included: string[] }
  workers: string[]
  includeOptional: boolean
}

export interface ExportSelection {
  sampleIds: string[]
  serviceIds: string[]
}

export class ExportError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = 'ExportError'
    this.status = status
  }
}

/** Validate a caller-supplied id list; empty input yields an empty list. */
function parseIdList(raw: unknown, kind: 'sample' | 'service'): string[] {
  const ids = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : []
  const cleaned = ids
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)

  for (const id of cleaned) {
    if (!ENTITY_ID_RE.test(id)) {
      throw new ExportError(`Invalid ${kind} id: ${id}`, 400)
    }
  }
  return [...new Set(cleaned)]
}

/**
 * Validate caller-supplied sample/service ids before they reach the spawned
 * script. Samples may be empty for a services-only export — the only invalid
 * selection is one with neither samples nor services.
 */
export function parseExportSelection(
  rawSamples: unknown,
  rawServices: unknown,
): ExportSelection {
  const sampleIds = parseIdList(rawSamples, 'sample')
  const serviceIds = parseIdList(rawServices, 'service')
  if (sampleIds.length === 0 && serviceIds.length === 0) {
    throw new ExportError('At least one sample or service id is required', 400)
  }
  return { sampleIds, serviceIds }
}

interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

function runExportScript(
  args: string[],
  timeoutMs: number,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [EXPORT_SCRIPT, ...args], {
      cwd: REPO_ROOT,
      // `ELECTRON_RUN_AS_NODE` makes process.execPath behave as a plain Node
      // runtime inside the packaged Electron app; it is a no-op under dev Node.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })

    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d) => {
      stdout += d.toString()
    })
    proc.stderr?.on('data', (d) => {
      stderr += d.toString()
    })

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new ExportError('Export timed out', 504))
    }, timeoutMs)

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code })
    })
  })
}

/** Build the id-selection CLI args, omitting empty lists entirely. */
function selectionArgs({ sampleIds, serviceIds }: ExportSelection): string[] {
  const args: string[] = []
  if (sampleIds.length > 0) args.push(`--samples=${sampleIds.join(',')}`)
  if (serviceIds.length > 0) args.push(`--services=${serviceIds.join(',')}`)
  return args
}

/** Resolve the export plan (services, workers, samples) without writing files. */
export async function resolveExportPlan(
  selection: ExportSelection,
  includeOptional: boolean,
): Promise<ExportPlan> {
  const { stdout, stderr, exitCode } = await runExportScript(
    [
      ...selectionArgs(selection),
      includeOptional ? '--include-optional' : '--no-optional',
      '--dry-run',
      '--json',
    ],
    PLAN_TIMEOUT_MS,
  )

  if (exitCode !== 0) {
    logger.error(`Export plan failed: ${stderr}`)
    throw new ExportError(stderr.trim() || 'Failed to resolve export plan', 400)
  }
  try {
    return JSON.parse(stdout) as ExportPlan
  } catch {
    logger.error(`Could not parse export plan: ${stdout}`)
    throw new ExportError('Could not parse export plan', 500)
  }
}

export interface ExportBundle {
  /** Directory containing the self-contained export (inside `tmpDir`). */
  outDir: string
  /** Root temp directory — caller must `cleanupBundle` it when done. */
  tmpDir: string
}

/** Run a full export into a fresh temp directory. Caller must clean it up. */
export async function buildExportBundle(
  selection: ExportSelection,
  includeOptional: boolean,
): Promise<ExportBundle> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'edge-ai-export-'))
  const outDir = path.join(tmpDir, 'export')

  const { stderr, exitCode } = await runExportScript(
    [
      ...selectionArgs(selection),
      includeOptional ? '--include-optional' : '--no-optional',
      `--out=${outDir}`,
    ],
    EXPORT_TIMEOUT_MS,
  )

  if (exitCode !== 0) {
    await cleanupBundle(tmpDir)
    logger.error(`Export failed: ${stderr}`)
    throw new ExportError(stderr.trim() || 'Export failed', 500)
  }
  return { outDir, tmpDir }
}

export async function cleanupBundle(tmpDir: string): Promise<void> {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
}

/** Build a safe download filename for the exported zip. */
export function exportFileName({
  sampleIds,
  serviceIds,
}: ExportSelection): string {
  const slug = [...sampleIds, ...serviceIds]
    .join('_')
    .replace(/[^a-z0-9_-]/gi, '')
    .slice(0, 80)
  return `edge-ai-demo-studio-${slug || 'samples'}.zip`
}
