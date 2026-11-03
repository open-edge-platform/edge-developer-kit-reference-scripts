// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ModelSource } from '@/types/common'
import type {
  BackendId,
  ListedModel,
  ModelSelection,
  MultiserveModel,
} from './types'

/**
 * Which quant of a model-list row a click selects or a delete removes. The engine lists a llama.cpp
 * repo as one row with all its quants, but starts and deletes `<repo>:<QUANT>`.
 */

/** Placeholders the engine lists for a file whose quant it cannot name. */
const UNNAMED_QUANTS = new Set(['', 'N/A', 'Unknown Quant'])

type RowModel = Pick<MultiserveModel, 'repo_id' | 'downloaded' | 'verified'>

/** Every quant a row shows: downloaded ones first, then verified, once each. */
export function rowQuants(model: RowModel): string[] {
  return [...new Set([...model.downloaded, ...model.verified])]
}

/** Whether `quant` names something the engine can start as `<repo>:<quant>`. */
export function isSelectableQuant(quant: string): boolean {
  return !UNNAMED_QUANTS.has(quant)
}

/**
 * The quant a click on the row selects: `chosenQuant` (pass it only for the selected row) while the
 * row still lists it, so re-clicking keeps a quant picked from the badges; else a verified quant,
 * then the first downloaded one.
 */
export function quantForRowClick(
  model: RowModel,
  chosenQuant?: string,
): string | undefined {
  if (
    chosenQuant &&
    isSelectableQuant(chosenQuant) &&
    rowQuants(model).includes(chosenQuant)
  ) {
    return chosenQuant
  }
  return model.verified[0] ?? model.downloaded[0]
}

/**
 * The quant a delete can remove on its own: the chosen quant, when it is on disk alongside other
 * downloaded quants (with only one, deleting the row deletes exactly that).
 */
export function quantDeleteTarget(
  model: RowModel,
  chosenQuant?: string,
): string | undefined {
  if (
    !chosenQuant ||
    !isSelectableQuant(chosenQuant) ||
    !model.downloaded.includes(chosenQuant)
  ) {
    return undefined
  }
  return model.downloaded.length > 1 ? chosenQuant : undefined
}

/**
 * The repo and quant of a saved llama.cpp model, whose quant is in its name (`<repo>:<QUANT>`) or
 * in its own field. Repo ids hold no ':'.
 */
export function splitModelName(
  name: string,
  quant?: string | null,
): { repoId: string; quant?: string } {
  const colon = name.indexOf(':')
  if (colon === -1) return { repoId: name, quant: quant || undefined }
  return {
    repoId: name.slice(0, colon),
    quant: quant || name.slice(colon + 1) || undefined,
  }
}

/**
 * The `<repo>:<QUANT>` a llama.cpp model is saved and started as, whether
 * its quant is baked into `name` or kept in its own field.
 */
export function llamaModelName(name: string, quant?: string | null): string {
  const split = splitModelName(name, quant)
  return joinModelName(split.repoId, split.quant)
}

/** `<repo>:<QUANT>`, or the repo alone without a quant; the inverse of {@link splitModelName}. */
export function joinModelName(repoId: string, quant?: string | null): string {
  return quant ? `${repoId}:${quant}` : repoId
}

/** Whether a row matches the search; a full id (`org/model:QUANT`) finds the row with that quant. */
export function matchesModelSearch(model: RowModel, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [
    model.repo_id,
    ...rowQuants(model).map((quant) => `${model.repo_id}:${quant}`),
  ].some((id) => id.toLowerCase().includes(q))
}

/**
 * What picking a listed model selects: its repo run as `quant`, on the panel's backend (else the
 * row's), with its verified weight format and the panel's registry.
 */
export function rowSelection(
  model: ListedModel,
  {
    backend,
    quant,
    source,
  }: { backend?: BackendId; quant?: string; source?: ModelSource },
): ModelSelection {
  return {
    repoId: model.repo_id,
    backend: backend ?? model.backend,
    taskType: model.task_type === 'multimodal' ? 'multimodal' : 'default',
    quant,
    weightFormat: model.verified[0],
    source,
  }
}
