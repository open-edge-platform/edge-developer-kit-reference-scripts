// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WORKER_DIR } from '@/lib/constants'
import { logger } from '@/lib/logger'

// The export tooling lives at <repo-root>/scripts/export-samples.mjs. WORKER_DIR
// is <repo-root>/workers, so the repo root is one level up — this mirrors how
// the rest of the app resolves project paths (see lib/constants.ts).
const REPO_ROOT = path.resolve(WORKER_DIR, '..')
const EXPORT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'export-samples.mjs')

// Sample ids are folder names; keep the allow-list strict so nothing resembling
// a flag (e.g. `--out`) can be smuggled in as a "sample".
const SAMPLE_ID_RE = /^[a-z0-9][a-z0-9-]*$/

const PLAN_TIMEOUT_MS = 30_000
const EXPORT_TIMEOUT_MS = 5 * 60_000

export interface ExportSampleSummary {
  id: string
  deps: { serviceId: string; role: 'required' | 'optional' }[]
}

export interface ExportPlan {
  samples: ExportSampleSummary[]
  services: { required: string[]; optional: string[]; included: string[] }
  workers: string[]
  includeOptional: boolean
}

export class ExportError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = 'ExportError'
    this.status = status
  }
}

/** Validate caller-supplied sample ids before they reach the spawned script. */
export function parseSampleIds(raw: unknown): string[] {
  const ids = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : []
  const cleaned = ids
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)

  if (cleaned.length === 0) {
    throw new ExportError('At least one sample id is required', 400)
  }
  for (const id of cleaned) {
    if (!SAMPLE_ID_RE.test(id)) {
      throw new ExportError(`Invalid sample id: ${id}`, 400)
    }
  }
  return [...new Set(cleaned)]
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

/** Resolve the export plan (services, workers, samples) without writing files. */
export async function resolveExportPlan(
  sampleIds: string[],
  includeOptional: boolean,
): Promise<ExportPlan> {
  const { stdout, stderr, exitCode } = await runExportScript(
    [
      `--samples=${sampleIds.join(',')}`,
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
  sampleIds: string[],
  includeOptional: boolean,
): Promise<ExportBundle> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'edge-ai-export-'))
  const outDir = path.join(tmpDir, 'export')

  const { stderr, exitCode } = await runExportScript(
    [
      `--samples=${sampleIds.join(',')}`,
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
export function exportFileName(sampleIds: string[]): string {
  const slug = sampleIds
    .join('_')
    .replace(/[^a-z0-9_-]/gi, '')
    .slice(0, 80)
  return `edge-ai-demo-studio-${slug || 'samples'}.zip`
}
