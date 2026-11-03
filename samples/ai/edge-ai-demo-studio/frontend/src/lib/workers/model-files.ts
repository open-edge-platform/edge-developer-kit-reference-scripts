// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { MODELS_DIR, REPO_ROOT } from '@/lib/constants'
import { getErrorMessage } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'
import { getWorkerConfig } from '@/services/worker-registry'

/** Whether `child` lies strictly inside `parent` (not `parent` itself). */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(rel)
  )
}

/** A repo-relative `modelDirectories` entry as an absolute path, or null if it escapes the root. */
export function resolveModelDir(dir: string): string | null {
  const resolved = path.resolve(REPO_ROOT, dir)
  return resolved === REPO_ROOT || isInside(REPO_ROOT, resolved)
    ? resolved
    : null
}

/** The shared Hugging Face home and hub folders, resolved as `worker_common.paths` does. */
function hfFolders(): { home: string; hub: string } {
  const home = process.env.HF_HOME || path.join(MODELS_DIR, 'huggingface')
  return { home, hub: process.env.HF_HUB_CACHE || path.join(home, 'hub') }
}

/** A repository folder of a Hugging Face cache (`models--org--name`). */
const HF_REPO_FOLDER = /^(models|datasets|spaces)--./

/** `dir` with symlinks resolved, or null when it is not on disk. */
function realDir(dir: string): Promise<string | null> {
  return fsp.realpath(/* turbopackIgnore: true */ dir).catch(() => null)
}

/**
 * `file` with its folders' symlinks resolved but not the entry itself (removing a symlink removes
 * the link); null when its folder is gone.
 */
async function realLocation(file: string): Promise<string | null> {
  const dir = await realDir(path.dirname(file))
  return dir === null ? null : path.join(dir, path.basename(file))
}

async function realDirs(dirs: (string | null)[]): Promise<string[]> {
  const resolved = await Promise.all(
    dirs.filter((dir): dir is string => dir !== null).map(realDir),
  )
  return resolved.filter((dir): dir is string => dir !== null)
}

/**
 * The `files` deleting a `type` model may remove: inside the type's `modelDirectories` or a repo
 * folder of the shared HF cache, never a folder that is or holds any service's model folder or a
 * cache root, so a wrong report cannot reach other models. Missing paths are dropped; the rest come
 * back once each, with folder symlinks resolved.
 */
export async function deletableModelFiles(
  type: Service['type'],
  files: string[],
): Promise<string[]> {
  const own = await realDirs(
    (getWorkerConfig(type)?.modelDirectories ?? []).map(resolveModelDir),
  )
  const { home, hub } = hfFolders()
  const hfCaches = await realDirs([hub, home])
  const protectedRoots = await realDirs([
    REPO_ROOT,
    MODELS_DIR,
    ...hfCaches,
    ...Object.keys(metaMap).flatMap((other) =>
      (getWorkerConfig(other as Service['type'])?.modelDirectories ?? []).map(
        resolveModelDir,
      ),
    ),
  ])

  const kept = new Set<string>()
  for (const file of files) {
    if (!path.isAbsolute(file)) {
      logger.warn(
        `${type}: ignoring a model file that is not absolute: ${file}`,
      )
      continue
    }
    const real = await realLocation(file)
    if (real === null) continue
    const inHfRepo = hfCaches.some(
      (cache) =>
        isInside(cache, real) &&
        HF_REPO_FOLDER.test(path.relative(cache, real).split(path.sep)[0]),
    )
    const allowed =
      (inHfRepo || own.some((dir) => isInside(dir, real))) &&
      !protectedRoots.some((root) => root === real || isInside(real, root))
    if (allowed) kept.add(real)
    else
      logger.debug(`${type}: not deleting ${real}: outside its model folders`)
  }
  return [...kept]
}

/**
 * Bytes `files` take, each inode counted once. Symlinks are not followed: a Hugging Face snapshot's
 * blobs are in the same repository folder.
 */
export async function diskUsage(files: string[]): Promise<number> {
  const seen = new Set<string>()
  const pending = [...files]
  let total = 0
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const stat = await fsp
      .lstat(/* turbopackIgnore: true */ next)
      .catch(() => null)
    if (!stat) continue
    const id = `${stat.dev}:${stat.ino}`
    if (seen.has(id)) continue
    seen.add(id)
    if (stat.isDirectory()) {
      const entries = await fsp
        .readdir(/* turbopackIgnore: true */ next)
        .catch(() => [])
      for (const entry of entries) pending.push(path.join(next, entry))
    } else if (stat.isFile()) {
      total += stat.size
    }
  }
  return total
}

/** `file` relative to the repository root when it lies under it, for display. */
export function displayModelPath(file: string): string {
  return isInside(REPO_ROOT, file) ? path.relative(REPO_ROOT, file) : file
}

/** Removes `files` (recursively); answers what it removed and what failed. */
export async function removeModelFiles(
  files: string[],
): Promise<{ removed: string[]; errors: string[] }> {
  const removed: string[] = []
  const errors: string[] = []
  for (const file of files) {
    try {
      await fsp.rm(/* turbopackIgnore: true */ file, {
        recursive: true,
        force: true,
      })
      removed.push(file)
      logger.info(`Deleted model files: ${file}`)
    } catch (error) {
      errors.push(`${displayModelPath(file)}: ${getErrorMessage(error)}`)
      logger.error(`Failed to delete model files ${file}:`, error)
    }
  }
  return { removed, errors }
}
