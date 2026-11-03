// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useSampleInstances } from '@/context/sample-instances-context'
import { useServiceStatus } from '@/context/service-status-context'
import { createInstance } from '@/hooks/use-instances'
import { bindSampleInstance } from '@/hooks/use-sample-settings'
import { updateServiceConfig } from '@/hooks/use-service-config'
import {
  patchServiceAction,
  type PayloadServiceInfo,
  resolveServiceInfo,
  SERVICES_QUERY_KEY,
} from '@/hooks/use-services'
import { getErrorMessage } from '@/lib/errors'
import { uniqueInstanceLabel } from '@/lib/instances/instances'
import { addInstanceAvailability } from '@/lib/instances/service-presentation'
import type { ResolvedRecommendation } from '@/samples/types'
import { getServiceById } from '@/services/registry'

/** One setting the recommendation would change on the target instance. */
export interface RecommendedChange {
  label: 'Device' | 'Model' | 'Backend' | 'Quantization'
  from: string | undefined
  to: string
}

interface RecommendedModelConfig {
  name?: string
  device?: string
  backend?: string
  quant?: string
  /** `multimodal` for a vision model. */
  type?: string
}

/** Onto the existing instance (`update`), or onto a new one next to it (`create`). */
export type RecommendedApplyMode = 'update' | 'create'

/** The mode chosen for each service id; a service left out is updated. */
export type RecommendedApplyModes = Partial<
  Record<string, RecommendedApplyMode>
>

/** What applying one recommendation would do, resolved against the instance the sample uses. */
export interface RecommendedApplyPlan {
  serviceId: string
  name: string
  /** The bound instance, else the type's primary one. Updated, or copied by a create. */
  target: PayloadServiceInfo | undefined
  /**
   * Adds an instance instead of changing one: the service's first (no `target`; server defaults fill
   * the gaps), or in mode `create` a copy of `target` that this sample then uses.
   */
  create: boolean
  /** Set when the change could go onto a new instance instead; `createUnavailable` says why not. */
  choice?: { mode: RecommendedApplyMode; createUnavailable?: string }
  /** The new instance's name, for a create next to `target`. */
  label?: string
  changes: RecommendedChange[]
  /** The target already has these settings. */
  noop: boolean
  /** The target is running and is restarted after the save to pick the settings up. */
  willRestart: boolean
  /** Nothing can be applied: status unknown, or no device/model to write. */
  blocked?: string
  /** The full model for a PATCH or a copy of `target`; only the recommended fields for a first instance. */
  config?: RecommendedModelConfig
}

export interface RecommendedApplyResult {
  serviceId: string
  status: 'done' | 'failed'
  error?: string
  /** Done, short of one step: the new instance exists but the sample still uses the old one. */
  warning?: string
}

interface PlanContext {
  serviceInfoMap: Record<string, PayloadServiceInfo>
  bindings: Record<string, string> | undefined
  modes: RecommendedApplyModes
  /** A new instance can be put in use: the dialog is on a sample page. */
  canBind: boolean
  /** Nothing reliable to plan against yet, and why. */
  unknownReason: string | undefined
}

function createChanges(cfg: ResolvedRecommendation): RecommendedChange[] {
  const changes: RecommendedChange[] = []
  if (cfg.device)
    changes.push({ label: 'Device', from: undefined, to: cfg.device })
  if (cfg.model)
    changes.push({ label: 'Model', from: undefined, to: cfg.model })
  if (cfg.backend)
    changes.push({ label: 'Backend', from: undefined, to: cfg.backend })
  if (cfg.quant)
    changes.push({ label: 'Quantization', from: undefined, to: cfg.quant })
  return changes
}

/** What applying one recommendation would do to the instance the sample uses. */
function planRecommendation(
  cfg: ResolvedRecommendation,
  { serviceInfoMap, bindings, modes, canBind, unknownReason }: PlanContext,
): RecommendedApplyPlan {
  const staticService = getServiceById(cfg.serviceId)
  const target = resolveServiceInfo(
    serviceInfoMap,
    bindings?.[cfg.serviceId] ?? cfg.serviceId,
  )
  const base = {
    serviceId: cfg.serviceId,
    name: staticService?.name ?? cfg.serviceId,
    target,
    create: false,
    noop: false,
    willRestart: false,
  }
  if (unknownReason) return { ...base, changes: [], blocked: unknownReason }

  if (!target) {
    // No instance yet: send only what the recommendation pins; the server
    // seeds the rest.
    return {
      ...base,
      create: true,
      changes: createChanges(cfg),
      config: {
        ...(cfg.model ? { name: cfg.model } : {}),
        ...(cfg.device ? { device: cfg.device } : {}),
        ...(cfg.backend ? { backend: cfg.backend } : {}),
        ...(cfg.quant ? { quant: cfg.quant } : {}),
        ...(cfg.modelType ? { type: cfg.modelType } : {}),
      },
    }
  }

  const device = cfg.device ?? target.currentDevice
  const modelName =
    cfg.model ?? target.currentModel ?? staticService?.defaultModel?.name ?? ''
  if (!device || !modelName) {
    return {
      ...base,
      changes: [],
      blocked: !device
        ? 'No device to apply: choose one in the service settings first.'
        : 'No model to apply: choose one in the service settings first.',
    }
  }
  const backend = cfg.backend ?? target.currentBackend
  const quant = cfg.quant ?? target.currentQuant
  // A recommended model brings its own type; the row's goes with its model.
  const type = cfg.model ? cfg.modelType : target.currentModelType

  const changes: RecommendedChange[] = []
  if (device !== target.currentDevice)
    changes.push({ label: 'Device', from: target.currentDevice, to: device })
  if (modelName !== target.currentModel)
    changes.push({ label: 'Model', from: target.currentModel, to: modelName })
  if (backend && backend !== target.currentBackend)
    changes.push({ label: 'Backend', from: target.currentBackend, to: backend })
  if (quant && quant !== target.currentQuant)
    changes.push({
      label: 'Quantization',
      from: target.currentQuant,
      to: quant,
    })

  const noop = changes.length === 0
  const update: RecommendedApplyPlan = {
    ...base,
    changes,
    noop,
    willRestart: !noop && target.status === 'online',
    config: {
      name: modelName,
      device,
      ...(backend ? { backend } : {}),
      ...(quant ? { quant } : {}),
      ...(type ? { type } : {}),
    },
  }
  if (noop || !staticService?.multiInstance || !canBind) return update

  const siblings = Object.values(serviceInfoMap).filter(
    (info) => info.type === cfg.serviceId,
  )
  const availability = addInstanceAvailability({
    multiInstance: true,
    maxInstances: staticService.maxInstances,
    instances: siblings,
  })
  if (!availability.allowed) {
    return {
      ...update,
      choice: { mode: 'update', createUnavailable: availability.reason },
    }
  }
  if (modes[cfg.serviceId] !== 'create') {
    return { ...update, choice: { mode: 'update' } }
  }
  // The copy gets what the update would write; the target is left untouched.
  return {
    ...update,
    create: true,
    willRestart: false,
    choice: { mode: 'create' },
    label: uniqueInstanceLabel(
      base.name,
      siblings.map((info) => info.label),
    ),
  }
}

/** The plan behind "Review recommended settings", per service. Nothing is applied here. */
export function useRecommendedConfigPlan(
  configs: ResolvedRecommendation[],
  modes: RecommendedApplyModes = {},
): RecommendedApplyPlan[] {
  const { serviceInfoMap, loading, connectionError, stale } = useServiceStatus()
  const sample = useSampleInstances()
  // Without a loaded list, applying would add duplicates of existing rows;
  // without bindings, it could update an instance the sample does not use.
  const unknownReason = loading
    ? 'Checking services…'
    : connectionError && !stale
      ? 'Service status is unavailable; retry from the checklist.'
      : sample?.bindingsUnavailable
        ? 'The instances this sample uses could not be loaded; retry from the checklist.'
        : undefined
  return configs.map((cfg) =>
    planRecommendation(cfg, {
      serviceInfoMap,
      bindings: sample?.bindings,
      modes,
      canBind: sample !== null,
      unknownReason,
    }),
  )
}

/**
 * Adds the instance a create plan asks for. Next to `target` it copies it and switches the sample
 * to the copy. A first instance sends partial picks as `model` overrides on the server's seeded
 * default, and a full model (name, device, backend) as `config`, stored as-is.
 * Returns a warning when the instance was added but the sample could not be switched to it.
 */
async function createInstanceFromPlan(
  plan: RecommendedApplyPlan,
  queryClient: QueryClient,
  sampleId: string | undefined,
): Promise<string | undefined> {
  const model = plan.config ?? {}
  const source = plan.target
  if (source) {
    const doc = await createInstance(
      {
        type: plan.serviceId,
        label: plan.label ?? plan.name,
        copyFrom: source.id,
        config: model,
      },
      'Failed to add the instance',
    )
    if (!sampleId) return undefined
    try {
      await bindSampleInstance(queryClient, {
        sampleId,
        type: plan.serviceId,
        instance: doc.id,
      })
    } catch (error) {
      return `“${doc.label ?? doc.instanceId}” was added, but this sample still uses “${source.label}”: ${getErrorMessage(error, 'the switch failed')}. Pick it under “Use in this sample”.`
    }
    return undefined
  }
  const complete = model.name && model.device && model.backend
  await createInstance(
    {
      type: plan.serviceId,
      label: plan.name,
      ...(complete ? { config: model } : { model }),
    },
    'Failed to add the service',
  )
  return undefined
}

async function applyPlan(
  plan: RecommendedApplyPlan,
  queryClient: QueryClient,
  sampleId: string | undefined,
): Promise<string | undefined> {
  if (plan.blocked || !plan.config) {
    throw new Error(plan.blocked ?? 'Nothing to apply')
  }
  if (plan.create) return createInstanceFromPlan(plan, queryClient, sampleId)
  if (!plan.target) throw new Error('Nothing to apply')
  await updateServiceConfig({
    serviceId: plan.target.id,
    serviceType: plan.serviceId,
    config: plan.config,
  })
  // Saving never restarts a running instance on its own.
  if (plan.willRestart) await patchServiceAction(plan.target.id, 'restart')
  return undefined
}

/** Applies plans one request per service, reporting each outcome so failures can be retried alone. */
export function useApplyRecommendedConfig() {
  const queryClient = useQueryClient()
  const sampleId = useSampleInstances()?.sampleId

  return useMutation({
    mutationFn: async (
      plans: RecommendedApplyPlan[],
    ): Promise<RecommendedApplyResult[]> => {
      const settled = await Promise.allSettled(
        plans.map((plan) => applyPlan(plan, queryClient, sampleId)),
      )
      return settled.map((outcome, i) =>
        outcome.status === 'fulfilled'
          ? {
              serviceId: plans[i].serviceId,
              status: 'done' as const,
              ...(outcome.value ? { warning: outcome.value } : {}),
            }
          : {
              serviceId: plans[i].serviceId,
              status: 'failed' as const,
              error: getErrorMessage(outcome.reason, 'The request failed.'),
            },
      )
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY })
    },
  })
}
