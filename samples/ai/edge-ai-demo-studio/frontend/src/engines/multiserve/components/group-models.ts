// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { isBackendId } from '@/engines/multiserve/backends'
import { matchesModelSearch } from '@/engines/multiserve/quant-selection'
import type { ListedModel, MultiserveModel } from '@/engines/multiserve/types'

/** Listed first: the selected model, then by repo id. */
function byRepo(selected: string | undefined) {
  return (a: ListedModel, b: ListedModel) => {
    if (a.repo_id === selected) return -1
    if (b.repo_id === selected) return 1
    return a.repo_id.localeCompare(b.repo_id)
  }
}

/**
 * The model manager's rows, limited to `allowedTasks` (all when unset): the selectable ones
 * (downloaded or verified), and those matching `search` split into downloaded and available.
 */
export function groupModels(
  listed: Record<string, MultiserveModel[]> | undefined,
  {
    allowedTasks,
    search,
    selectedModel,
  }: {
    allowedTasks: string[] | undefined
    search: string
    selectedModel: string | undefined
  },
) {
  const models: ListedModel[] = Object.entries(listed ?? {}).flatMap(
    ([listedBackend, rows]) =>
      isBackendId(listedBackend)
        ? rows
            .filter((m) => !allowedTasks || allowedTasks.includes(m.task_type))
            .map((m) => ({ ...m, backend: listedBackend }))
        : [],
  )
  const selectable = models.filter(
    (m) => m.downloaded.length > 0 || m.verified.length > 0,
  )
  const shown = search.trim()
    ? selectable.filter((m) => matchesModelSearch(m, search))
    : selectable
  const downloaded = shown
    .filter((m) => m.downloaded.length > 0)
    .sort(byRepo(selectedModel))
  const available = shown
    .filter((m) => m.downloaded.length === 0)
    .sort(byRepo(selectedModel))
  // A model added by name is selected before the engine has it.
  const pendingDownload =
    selectedModel != null &&
    selectedModel.trim() !== '' &&
    !selectable.some((m) => m.repo_id === selectedModel)

  return { models, selectable, downloaded, available, pendingDownload }
}
