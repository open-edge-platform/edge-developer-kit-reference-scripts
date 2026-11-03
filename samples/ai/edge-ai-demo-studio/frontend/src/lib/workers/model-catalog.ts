// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { existsSync, promises as fsp } from 'node:fs'
import path from 'node:path'
import config from '@payload-config'
import { getPayload } from 'payload'
import { z } from 'zod'
import { getModelsDir, MULTISERVE_REPO_PATH } from '@/engines/multiserve/paths'
import type { BackendId, MultiserveModel } from '@/engines/multiserve/types'
import { REPO_ROOT, UV_PATH } from '@/lib/constants'
import { getErrorMessage } from '@/lib/errors'
import { globalSingleton } from '@/lib/global-singleton'
import { DRAFT_ENGINE_INSTANCE_ID } from '@/lib/instances/instances'
import { isRunningPayloadStatus } from '@/lib/instances/service-status'
import { logger } from '@/lib/logger'
import { runCommand } from '@/lib/system/spawn'
import { ApiError } from '@/lib/api/errors'
import {
  findPrimaryInstance,
  getWorkloadInstance,
} from '@/lib/workers/instance-lookup'
import { seedInstanceSettings, serverOS } from '@/lib/workers/instance-seed'
import { appliedConfigOf } from '@/lib/workers/applied-config'
import {
  deletableModelFiles,
  diskUsage,
  displayModelPath,
  removeModelFiles,
} from '@/lib/workers/model-files'
import { resolveWorkerDir } from '@/lib/workers/worker-dir'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'
import type { WorkerModelCatalog } from '@/services/types'
import { getWorkerConfig } from '@/services/worker-registry'

/** One preset entry of a worker service's static model list. */
export interface WorkerCatalogModel {
  name: string
  downloaded: boolean
  /** Scripts emit `null` (not just `undefined`) when a preset has no path. */
  path?: string | null
  /** What deleting the preset removes (also if partly downloaded), repo-relative; absent if unreported. */
  files?: string[]
  /** Bytes `files` take on disk. */
  size?: number
}

/**
 * Model catalogue scanned from disk without starting anything. `multiserve` mirrors the engine's
 * `GET /v1/models`, `worker` follows the worker's `modelCatalog`, and `unsupported` has no
 * per-preset state (none declared, or the scan failed: see `error`).
 */
export type ModelCatalog =
  | {
      kind: 'multiserve'
      models: { openvino?: MultiserveModel[]; llamacpp?: MultiserveModel[] }
    }
  | { kind: 'worker'; models: WorkerCatalogModel[] }
  | { kind: 'unsupported'; error?: string }

/** The branches a catalogue request may force (`?engine=`). */
export const CATALOG_ENGINES = ['worker', 'multiserve'] as const
export type CatalogEngine = (typeof CATALOG_ENGINES)[number]

export interface GetModelCatalogOptions {
  type: Service['type']
  /** Specific instance (`type@instanceId`) to scan; defaults to the type's primary instance. */
  instanceKey?: string
  /** Restrict a multiserve scan to one backend. */
  provider?: BackendId
  /** Overrides the instance's stored engine, for a New-instance draft on the other engine. */
  engine?: CatalogEngine
}

const CACHE_TTL_MS = 20_000

interface CacheEntry {
  expiresAt: number
  value: ModelCatalog
}

// On `globalThis`: routes that change models on disk are separate bundles in dev, and their
// invalidations must reach the cache the catalogue route reads.
const cache = globalSingleton(
  'modelCatalogCache',
  () => new Map<string, CacheEntry>(),
)
// Concurrent callers for one key (several components poll) share one `list_models.py` run.
const inFlight = globalSingleton(
  'modelCatalogInFlight',
  () => new Map<string, Promise<ModelCatalog>>(),
)

/**
 * Drops the cached catalogues of `type` (or all). A scan already running may predate the change, so
 * later requests do not join it and its result is not cached.
 */
export function invalidateModelCatalog(type?: string): void {
  for (const store of [cache, inFlight]) {
    for (const key of store.keys()) {
      if (type === undefined || key.startsWith(`${type} `)) store.delete(key)
    }
  }
}

const multiserveModelSchema = z.object({
  repo_id: z.string(),
  task_type: z.string(),
  verified: z.array(z.string()),
  downloaded: z.array(z.string()),
  sources: z.array(z.string()),
}) satisfies z.ZodType<MultiserveModel>

/** `list_models.py --model-dir` output: models per backend, plus warnings. */
const multiserveScanSchema = z.object({
  openvino: z.array(multiserveModelSchema).optional(),
  llamacpp: z.array(multiserveModelSchema).optional(),
  warnings: z.array(z.string()).optional(),
})

/** A worker's `list_models.py --models` output. */
const workerScanSchema = z.array(
  z.object({
    name: z.string(),
    downloaded: z.boolean(),
    path: z.string().nullish(),
    // Absolute paths; scripts that predate per-model delete omit them.
    files: z.array(z.string()).optional(),
  }),
)

/** The command's stdout parsed with `schema`; throws with what was wrong. */
function parseScanOutput<S extends z.ZodType>(
  stdout: string,
  schema: S,
): z.output<S> {
  return schema.parse(JSON.parse(stdout.trim()))
}

/** A catalogue that could not be scanned, with why. */
function unsupported(type: Service['type'], error: unknown): ModelCatalog {
  logger.error(`Failed to scan the model catalogue for ${type}:`, error)
  return { kind: 'unsupported', error: getErrorMessage(error) }
}

function cacheKey(options: GetModelCatalogOptions): string {
  const { type, instanceKey, provider, engine } = options
  // Multiserve's models directory is per type, so when the query alone pins that branch the
  // instance cannot change the result; otherwise the row's own engine decides the branch.
  const isExplicitMultiserve = provider != null || engine === 'multiserve'
  return `${type} ${isExplicitMultiserve ? '' : (instanceKey ?? '')} ${provider ?? ''} ${engine ?? ''}`
}

async function scanMultiserve(
  type: Service['type'],
  provider: BackendId | undefined,
): Promise<ModelCatalog> {
  const args = [
    'run',
    '--no-sync',
    '--frozen',
    'list_models.py',
    '--model-dir',
    getModelsDir(type),
  ]
  if (provider) args.push('--provider', provider)

  try {
    // `runCommand`'s 30 s deadline kills the child; a shorter race on top would let the route give up
    // while the child kept running.
    const result = await runCommand(UV_PATH, args, {
      cwd: MULTISERVE_REPO_PATH,
    })
    if (result.exitCode !== 0) {
      return unsupported(
        type,
        result.stderr.trim() || `list_models.py exited ${result.exitCode}`,
      )
    }

    const { warnings, ...models } = parseScanOutput(
      result.stdout,
      multiserveScanSchema,
    )
    if (warnings && warnings.length > 0) {
      logger.warn(`list_models.py warnings for ${type}: ${warnings.join('; ')}`)
    }
    return { kind: 'multiserve', models }
  } catch (error) {
    return unsupported(type, error)
  }
}

/**
 * Preset ids to scan: the static list plus the row's current model, split on commas (wake words save
 * several). Ids starting with `-` are dropped: argparse would read them as flags.
 */
function candidateIds(type: Service['type'], row: Service): string[] {
  const ids = new Set<string>()
  for (const model of metaMap[type]?.config?.availableModels ?? []) {
    if (!model.value.startsWith('-')) ids.add(model.value)
  }
  const current = row.models?.default?.name ?? ''
  for (const id of current
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (!id.startsWith('-')) ids.add(id)
  }
  return [...ids]
}

/** Default `catalogRows`: the row with the preset as its model, which `workerSubDir` may read. */
function rowWithModel(row: Service, id: string): Service[] {
  return [
    {
      ...row,
      models: { ...row.models, default: { ...row.models?.default, name: id } },
    },
  ]
}

/**
 * Groups `ids` by the worker directory each resolves to. A service whose worker depends on the model
 * or anything else declares that through `catalogRows`.
 */
function groupIdsByWorkerDir(
  type: Service['type'],
  row: Service,
  ids: string[],
): { workerDir: string; ids: string[] }[] {
  const groups = new Map<string, Set<string>>()
  const addTo = (workerDir: string, id: string) => {
    const group = groups.get(workerDir) ?? new Set<string>()
    group.add(id)
    groups.set(workerDir, group)
  }

  const catalogRows = getWorkerConfig(type)?.catalogRows ?? rowWithModel
  for (const id of ids) {
    for (const variant of catalogRows(row, id)) {
      addTo(resolveWorkerDir(variant), id)
    }
  }

  return [...groups.entries()].map(([workerDir, idSet]) => ({
    workerDir,
    ids: [...idSet],
  }))
}

/**
 * Absolute files matching a repo-relative path or glob; a zero-byte file (an interrupted download)
 * is not `complete`, as in the worker scripts. Never matches outside the root.
 */
async function presetMatches(
  pattern: string,
): Promise<{ file: string; complete: boolean }[]> {
  const rel = path.relative(REPO_ROOT, path.resolve(REPO_ROOT, pattern))
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return []
  }
  const matches: { file: string; complete: boolean }[] = []
  for await (const match of fsp.glob(pattern, { cwd: REPO_ROOT })) {
    const abs = path.join(REPO_ROOT, match)
    const stat = await fsp
      .stat(/* turbopackIgnore: true */ abs)
      .catch(() => null)
    if (stat && stat.isFile())
      matches.push({ file: abs, complete: stat.size > 0 })
  }
  return matches
}

/**
 * The `{ presetPaths }` catalogue: downloaded when every pattern matches a non-empty file; every
 * match, empty or not, is in `files`. Unlisted ids (custom models) are left out: nothing can tell.
 */
async function checkPresetPaths(
  ids: string[],
  presetPaths: Extract<WorkerModelCatalog, object>['presetPaths'],
): Promise<WorkerCatalogModel[]> {
  const models: WorkerCatalogModel[] = []
  for (const id of ids) {
    const patterns = presetPaths[id]
    if (patterns == null) continue
    let firstPath: string | null = null
    let downloaded = true
    const files: string[] = []
    for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
      const matches = await presetMatches(pattern)
      files.push(...matches.map((m) => m.file))
      const complete = matches.find((m) => m.complete)
      if (!complete) downloaded = false
      else if (firstPath === null) firstPath = complete.file
    }
    models.push({
      name: id,
      downloaded,
      path: downloaded ? firstPath : null,
      files,
    })
  }
  return models
}

/** The worker's `modelCatalog` answer for `ids`; null when it declares none, throws if the scan fails. */
async function scanWorkerIds(
  type: Service['type'],
  row: Service,
  ids: string[],
): Promise<WorkerCatalogModel[] | null> {
  const mode = getWorkerConfig(type)?.modelCatalog
  if (mode == null) return null
  if (ids.length === 0) return []
  if (mode !== 'script') return checkPresetPaths(ids, mode.presetPaths)

  // A missing worker directory (one this checkout does not ship) leaves its ids unanswered; one
  // without list_models.py is a config error, so it is reported.
  const groups = groupIdsByWorkerDir(type, row, ids).filter(({ workerDir }) =>
    existsSync(workerDir),
  )
  const missingScript = groups
    .filter(
      ({ workerDir }) => !existsSync(path.join(workerDir, 'list_models.py')),
    )
    .map(({ workerDir }) => path.relative(REPO_ROOT, workerDir))
  if (missingScript.length > 0) {
    throw new Error(
      `modelCatalog is 'script' but list_models.py is missing in ${missingScript.join(', ')}`,
    )
  }
  if (groups.length === 0) {
    throw new Error(`no worker directory found for ${type}`)
  }

  // A `runCommand` deadline ("timed out after …") rejects here too.
  const results = await Promise.all(
    groups.map(({ workerDir, ids: groupIds }) => {
      // Drop any leading-dash id right before spawning, so nothing that
      // reaches the command line can read as a flag.
      const safeIds = [...new Set(groupIds)].filter((id) => !id.startsWith('-'))
      return runCommand(
        UV_PATH,
        [
          'run',
          '--no-sync',
          '--frozen',
          'list_models.py',
          '--models',
          ...safeIds,
        ],
        { cwd: workerDir },
      )
    }),
  )

  const merged = new Map<string, WorkerCatalogModel>()
  for (const result of results) {
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() || `list_models.py exited ${result.exitCode}`,
      )
    }

    // A name reported by several directories (shared presets across backends) is downloaded if any
    // says so and owns all their files.
    for (const model of parseScanOutput(result.stdout, workerScanSchema)) {
      const existing = merged.get(model.name)
      if (!existing) {
        merged.set(model.name, model)
        continue
      }
      const files =
        existing.files || model.files
          ? [...new Set([...(existing.files ?? []), ...(model.files ?? [])])]
          : undefined
      const winner = !existing.downloaded && model.downloaded ? model : existing
      merged.set(model.name, { ...winner, files })
    }
  }
  return [...merged.values()]
}

/** `model` with its files limited to `deletableModelFiles`, shown repo-relative, plus their size. */
async function describeFiles(
  type: Service['type'],
  model: WorkerCatalogModel,
): Promise<WorkerCatalogModel> {
  if (model.files === undefined) return model
  const files = await deletableModelFiles(type, model.files)
  return {
    ...model,
    files: files.map(displayModelPath),
    size: await diskUsage(files),
  }
}

async function scanWorker(
  type: Service['type'],
  row: Service,
): Promise<ModelCatalog> {
  try {
    const models = await scanWorkerIds(type, row, candidateIds(type, row))
    if (models === null) return { kind: 'unsupported' }
    return {
      kind: 'worker',
      models: await Promise.all(models.map((m) => describeFiles(type, m))),
    }
  } catch (error) {
    return unsupported(type, error)
  }
}

/**
 * The absolute files deleting `model` removes, freshly scanned and limited by `deletableModelFiles`.
 * Throws an `ApiError` when the worker cannot tell.
 */
async function presetFiles(
  type: Service['type'],
  row: Service,
  model: string,
): Promise<string[]> {
  let models: WorkerCatalogModel[] | null
  try {
    models = await scanWorkerIds(type, row, [model])
  } catch (error) {
    logger.error(`Failed to scan the files of ${type} model ${model}:`, error)
    throw new ApiError(
      500,
      `Could not check the files of ${model}: ${getErrorMessage(error)}`,
    )
  }
  const files = models?.find((m) => m.name === model)?.files
  if (files === undefined) {
    throw new ApiError(
      400,
      `${metaMap[type]?.name ?? type} does not report the files of a model; clear its model cache instead`,
    )
  }
  return deletableModelFiles(type, files)
}

/**
 * `instanceKey`'s row or the primary instance; `null` when the type has no row yet. A bad key throws
 * an `InstanceLookupError` (400/404).
 */
async function findCatalogRow(
  type: Service['type'],
  instanceKey: string | undefined,
): Promise<Service | null> {
  if (instanceKey) return getWorkloadInstance(type, instanceKey)
  return (await findPrimaryInstance(type)) ?? null
}

/**
 * A never-written stand-in row seeded like a first instance, for scanning a type with no rows.
 * `engine` forces the worker branch when the seed would run multiserve.
 */
function seededCatalogRow(
  type: Service['type'],
  engine?: Service['engine'],
): Service {
  const seed = seedInstanceSettings(type, serverOS())
  const now = new Date().toISOString()
  return {
    id: 0,
    name: metaMap[type]?.name ?? type,
    type,
    instanceId: DRAFT_ENGINE_INSTANCE_ID,
    ...seed,
    ...(engine ? { engine } : {}),
    port: null,
    status: 'inactive',
    createdAt: now,
    updatedAt: now,
  }
}

async function computeModelCatalog(
  options: GetModelCatalogOptions,
): Promise<ModelCatalog> {
  const { type, instanceKey, provider, engine } = options
  // A provider or explicit `engine` picks the branch whatever the rows run (a cross-engine draft);
  // multiserve's models directory is per type, so it needs no row.
  if (provider) return scanMultiserve(type, provider)
  if (engine === 'multiserve') return scanMultiserve(type, undefined)
  // The worker branch needs a row only for what it reads off it; a type
  // with no row yet is scanned as its seed (see `seededCatalogRow`).
  if (engine === 'worker') {
    const row = await findCatalogRow(type, instanceKey)
    return scanWorker(type, row ?? seededCatalogRow(type, 'worker'))
  }
  const row =
    (await findCatalogRow(type, instanceKey)) ?? seededCatalogRow(type)
  return row.engine === 'multiserve'
    ? scanMultiserve(type, provider)
    : scanWorker(type, row)
}

/**
 * The `ModelCatalog` for a type or instance, cached per key for 20 s (the client polls every 15 s)
 * and dropped by `invalidateModelCatalog`. Concurrent callers share one scan.
 */
export async function getModelCatalog(
  options: GetModelCatalogOptions,
): Promise<ModelCatalog> {
  const key = cacheKey(options)
  const cached = cache.get(key)
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.value
    cache.delete(key)
  }

  const pending = inFlight.get(key)
  if (pending) return pending

  // `inFlight` no longer holding this scan means an invalidation came in
  // while it ran (see `invalidateModelCatalog`).
  const promise: Promise<ModelCatalog> = computeModelCatalog(options)
    .then((value) => {
      if (inFlight.get(key) === promise) {
        cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value })
      }
      return value
    })
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key)
    })
  inFlight.set(key, promise)
  return promise
}

/** Model ids a row's worker loads: the saved ones and those its running process started with. */
function modelsOf(row: Service): string[] {
  return [row.models?.default?.name, appliedConfigOf(row)?.model]
    .flatMap((names) => (names ?? '').split(','))
    .map((id) => id.trim())
    .filter(Boolean)
}

/**
 * Deletes one worker model's files so its next start re-downloads it. `instanceKey` only picks the
 * worker where it depends on the row. 409 while an instance loading the model runs.
 */
export async function deleteWorkerModel({
  type,
  model,
  instanceKey,
}: {
  type: Service['type']
  model: string
  instanceKey?: string
}): Promise<{ deleted: string[]; errors: string[] }> {
  if (!model.trim() || model.startsWith('-') || model.length > 512) {
    throw new ApiError(400, 'Invalid model id')
  }

  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'services',
    where: { type: { equals: type } },
    pagination: false,
  })
  const using = docs.filter(
    (row) =>
      isRunningPayloadStatus(row.status) && modelsOf(row).includes(model),
  )
  if (using.length > 0) {
    const names = using.map((row) => row.label || row.name).join(', ')
    throw new ApiError(
      409,
      `Stop ${names} first: ${using.length === 1 ? 'it runs' : 'they run'} ${model}`,
    )
  }

  const row =
    (await findCatalogRow(type, instanceKey)) ??
    seededCatalogRow(type, 'worker')
  const files = await presetFiles(type, row, model)
  if (files.length === 0) {
    throw new ApiError(404, `No files of ${model} are on disk`)
  }
  const { removed, errors } = await removeModelFiles(files)
  // Every type: a Hugging Face repository folder may serve another one.
  invalidateModelCatalog()
  return { deleted: removed.map(displayModelPath), errors }
}
