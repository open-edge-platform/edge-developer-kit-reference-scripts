// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useServiceModelCatalog } from '@/hooks/use-model-catalog'
import { getDraftEngineKey, parseInstanceKey } from '@/lib/instances/instances'
import type { BackendId } from '../types'
import {
  draftEngineUrl,
  rowEngineUrl,
  useEngineHealth,
  useIsEngineStarting,
  useStartEngine,
  useStopDraftEngineOnUnmount,
} from './use-engine-health'
import { useMultiserveModels } from './use-models'

/**
 * The engine a model manager talks to (the instance's own, or the type's draft engine), its state,
 * and the models to list: the engine's live list, or the disk scan while it is not up.
 */
export function useModelManagerEngine({
  instanceKey,
  dbId,
  backend,
  draftEngine,
}: {
  instanceKey: string
  dbId?: number
  backend?: BackendId
  draftEngine: boolean
}) {
  const type = parseInstanceKey(instanceKey)?.type ?? instanceKey
  // Every engine call — health, models, upload, delete — goes to this key.
  const engineKey = draftEngine ? getDraftEngineKey(type) : instanceKey
  const engineUrl = draftEngine
    ? draftEngineUrl(type)
    : dbId != null
      ? rowEngineUrl(dbId)
      : undefined
  useStopDraftEngineOnUnmount(draftEngine ? type : undefined)

  const { data: isEngineUp } = useEngineHealth(engineKey)
  const { mutateAsync: startEngine } = useStartEngine(engineKey)
  const isWaitingForEngine = useIsEngineStarting(engineKey)
  const engineUp = isEngineUp === true

  // Resolves once the engine is up, starting it first when it is down;
  // rejects when the start failed, which the start has already toasted.
  const ensureEngine = () =>
    engineUp || engineUrl == null ? Promise.resolve() : startEngine(engineUrl)

  const live = useMultiserveModels(engineKey, backend, engineUp)
  // A draft keeps listing what is on disk until the live list has loaded, so
  // its rows — and a delete waiting on the engine start — stay mounted.
  const showLive = draftEngine ? engineUp && live.data !== undefined : engineUp

  // Until the engine is confirmed up, list the disk scan. A draft scans the type: a source row on
  // another engine says nothing about this one's disk.
  const disk = useServiceModelCatalog(draftEngine ? type : instanceKey, {
    provider: backend,
    enabled: !engineUp,
  })
  const catalogScanError =
    disk.data?.kind === 'unsupported' ? disk.data.error : undefined
  const listing = showLive
    ? live
    : {
        ...disk,
        data: disk.data?.kind === 'multiserve' ? disk.data.models : undefined,
      }

  return {
    engineKey,
    engineUp,
    isWaitingForEngine,
    ensureEngine,
    showLive,
    listing,
    catalogScanError,
  }
}
