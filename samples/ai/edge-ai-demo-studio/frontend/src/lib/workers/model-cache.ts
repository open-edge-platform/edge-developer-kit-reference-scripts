// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * A service type's whole model cache — the folders its worker declares as `modelDirectories`:
 * whether it holds anything, which other services share one of its folders, and clearing it. Per
 * type, not per instance: every instance of a type shares the folders, and a type nobody added may
 * still hold files from an earlier setup.
 */

import config from '@payload-config'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { getPayload } from 'payload'
import { ApiError } from '@/lib/api/errors'
import { getErrorMessage } from '@/lib/errors'
import { isRunningPayloadStatus } from '@/lib/instances/service-status'
import { logger } from '@/lib/logger'
import { invalidateModelCatalog } from '@/lib/workers/model-catalog'
import { resolveModelDir } from '@/lib/workers/model-files'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'
import { getWorkerConfig } from '@/services/worker-registry'

/** Whether one folder is the other or holds it. */
function overlaps(a: string, b: string): boolean {
  const inside = (rel: string) =>
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  return inside(path.relative(a, b)) || inside(path.relative(b, a))
}

/** The type's model folders, absolute; entries escaping the repository are dropped. */
function ownDirs(type: Service['type']): string[] {
  return (getWorkerConfig(type)?.modelDirectories ?? [])
    .map(resolveModelDir)
    .filter((dir): dir is string => dir !== null)
}

/** Whether any model folder of `type` overlaps `dirs`. */
function sharesFolder(type: Service['type'], dirs: string[]): boolean {
  return ownDirs(type).some((dir) => dirs.some((own) => overlaps(own, dir)))
}

/** Names of the other services with a model folder in common (the Hugging Face cache). */
export function modelCacheSharedWith(type: Service['type']): string[] {
  const own = ownDirs(type)
  return Object.entries(metaMap)
    .filter(
      ([other]) =>
        other !== type && sharesFolder(other as Service['type'], own),
    )
    .map(([, meta]) => meta.name)
}

/** Whether every model folder of `type` holds something; true for a type without any. */
export async function isModelCacheDownloaded(
  type: Service['type'],
): Promise<boolean> {
  const declared = getWorkerConfig(type)?.modelDirectories ?? []
  for (const dir of declared) {
    const resolved = resolveModelDir(dir)
    if (!resolved) {
      logger.error(`Path traversal detected while checking model dir: ${dir}`)
      return false
    }
    try {
      const entries = await fsp.readdir(/* turbopackIgnore: true */ resolved)
      if (entries.length === 0) return false
    } catch (error) {
      // A folder that does not exist yet: nothing was downloaded.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.debug(`Could not read model dir ${resolved}:`, error)
      }
      return false
    }
  }
  return true
}

/**
 * Removes every model folder of `type`, so the next start downloads its models again. Refused
 * (409) while any instance — of this type, or of one sharing a folder — is starting or running,
 * since it may be reading those files. Answers the folders removed and the ones that could not be.
 */
export async function clearModelCache(
  type: Service['type'],
): Promise<{ cleared: string[]; errors: string[] }> {
  const declared = getWorkerConfig(type)?.modelDirectories ?? []
  if (declared.length === 0) {
    throw new ApiError(
      400,
      'This service does not have any model directories configured',
    )
  }

  const own = ownDirs(type)
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'services',
    pagination: false,
  })
  const using = docs.filter(
    (row) => isRunningPayloadStatus(row.status) && sharesFolder(row.type, own),
  )
  if (using.length > 0) {
    const names = using.map((row) => row.label || row.name).join(', ')
    throw new ApiError(
      409,
      `Stop ${names} first: ${using.length === 1 ? 'it uses' : 'they use'} the same model files`,
    )
  }

  const cleared: string[] = []
  const errors: string[] = []
  for (const dir of declared) {
    const resolved = resolveModelDir(dir)
    if (!resolved) {
      errors.push(`${dir}: path traversal detected`)
      continue
    }
    try {
      await fsp.rm(/* turbopackIgnore: true */ resolved, {
        recursive: true,
        force: true,
      })
      cleared.push(dir)
      logger.info(`Cleared model cache directory: ${resolved}`)
    } catch (error) {
      errors.push(`${dir}: ${getErrorMessage(error)}`)
      logger.error(`Failed to clear model cache directory ${resolved}:`, error)
    }
  }

  // Every type: a shared folder (the Hugging Face cache) serves others too.
  invalidateModelCatalog()
  return { cleared, errors }
}
