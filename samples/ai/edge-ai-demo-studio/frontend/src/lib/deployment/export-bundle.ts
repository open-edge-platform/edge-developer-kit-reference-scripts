// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { REPO_ROOT } from '@/lib/constants'
import { logger } from '@/lib/logger'
import {
  type CommandResult,
  CommandInterruptedError,
  runCommand,
} from '@/lib/system/spawn'

const EXPORT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'export-bundle.mjs')

// Sample/service ids are folder names; keep the allow-list strict so nothing
// resembling a flag (e.g. `--out`) can be smuggled in as an id.
const ENTITY_ID_RE = /^[a-z0-9][a-z0-9-]*$/

const PLAN_TIMEOUT_MS = 30_000
const EXPORT_TIMEOUT_MS = 5 * 60_000

const exportPlanSchema = z.object({
  samples: z.array(
    z.object({
      id: z.string(),
      deps: z.array(
        z.object({
          serviceId: z.string(),
          role: z.enum(['required', 'optional']),
        }),
      ),
    }),
  ),
  /** Service ids the caller asked for directly (not derived from samples). */
  requestedServices: z.array(z.string()),
  services: z.object({
    required: z.array(z.string()),
    optional: z.array(z.string()),
    included: z.array(z.string()),
  }),
  workers: z.array(z.string()),
  includeOptional: z.boolean(),
})

/** What `GET /api/export-bundle` answers: what an export would contain. */
export type ExportPlan = z.infer<typeof exportPlanSchema>

export interface ExportSelection {
  sampleIds: string[]
  serviceIds: string[]
}

/** A failed export, with the status the route answers it with. */
export class ExportError extends ApiError {
  constructor(message: string, status = 500) {
    super(status, message)
    this.name = 'ExportError'
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

/** Validates ids before they reach the spawned script; at least one sample or service is required. */
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

interface RunOptions {
  /** Called with each complete output line as the script prints it. */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
  /** Aborting kills the script; the run rejects with a 499 `ExportError`. */
  signal?: AbortSignal
}

// Colour codes the codegen step may print; progress shows plain text.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g

async function runExportScript(
  args: string[],
  timeoutMs: number,
  { onLine, signal }: RunOptions = {},
): Promise<CommandResult> {
  try {
    return await runCommand(process.execPath, [EXPORT_SCRIPT, ...args], {
      cwd: REPO_ROOT,
      // `ELECTRON_RUN_AS_NODE` makes process.execPath behave as a plain Node
      // runtime inside the packaged Electron app; a no-op under dev Node.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeoutMs,
      signal,
      onLine:
        onLine && ((line, stream) => onLine(line.replace(ANSI_RE, ''), stream)),
    })
  } catch (error) {
    if (error instanceof CommandInterruptedError) {
      throw error.reason === 'timeout'
        ? new ExportError('Export timed out', 504)
        : new ExportError('Export cancelled', 499)
    }
    throw error
  }
}

/** Coarse steps of a full export, in the order the script runs them. */
export type ExportPhase = 'starting' | 'planning' | 'copying' | 'codegen'

/** One line of export output, with the step it belongs to (a `progress` event). */
export interface ExportProgress {
  phase: ExportPhase
  message: string
}

/** The export stream's final `done` event: where to fetch the finished zip. */
export interface ExportDone {
  downloadId: string
  fileName: string
  url: string
  /** Until when (epoch ms) `url` downloads the zip, as often as needed. */
  expiresAt: number
}

/**
 * The step a script output line starts, or `null` when it continues the
 * current one. Keyed on the headings `scripts/export-bundle.mjs` prints.
 */
function phaseOf(line: string): ExportPhase | null {
  if (line.startsWith('Export plan')) return 'planning'
  // The plan ends with the output path; copying starts right after it.
  if (/^\s*Output:/.test(line)) return 'copying'
  if (line.startsWith('Running codegen')) return 'codegen'
  return null
}

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
    return exportPlanSchema.parse(JSON.parse(stdout))
  } catch (error) {
    logger.error(`Could not parse export plan: ${stdout}`, error)
    throw new ExportError('Could not parse export plan', 500)
  }
}

export interface ExportBundle {
  /** Directory containing the self-contained export (inside `tmpDir`). */
  outDir: string
  /** Root temp directory — caller must `cleanupBundle` it when done. */
  tmpDir: string
}

export interface BuildOptions {
  /** Called with every line the export prints, tagged with its step. */
  onProgress?: (progress: ExportProgress) => void
  /** Aborting stops the export and removes its temp directory. */
  signal?: AbortSignal
}

/** Run a full export into a fresh temp directory. Caller must clean it up. */
export async function buildExportBundle(
  selection: ExportSelection,
  includeOptional: boolean,
  { onProgress, signal }: BuildOptions = {},
): Promise<ExportBundle> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'edge-ai-export-'))
  const outDir = path.join(tmpDir, 'export')

  let phase: ExportPhase = 'starting'
  onProgress?.({ phase, message: 'Starting export…' })
  let result: CommandResult
  try {
    result = await runExportScript(
      [
        ...selectionArgs(selection),
        includeOptional ? '--include-optional' : '--no-optional',
        `--out=${outDir}`,
      ],
      EXPORT_TIMEOUT_MS,
      {
        signal,
        onLine: onProgress
          ? (line) => {
              if (!line.trim()) return
              phase = phaseOf(line) ?? phase
              onProgress({ phase, message: line.trimEnd() })
            }
          : undefined,
      },
    )
  } catch (err) {
    await cleanupBundle(tmpDir)
    throw err
  }

  if (result.exitCode !== 0) {
    await cleanupBundle(tmpDir)
    logger.error(`Export failed: ${result.stderr}`)
    throw new ExportError(result.stderr.trim() || 'Export failed', 500)
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
