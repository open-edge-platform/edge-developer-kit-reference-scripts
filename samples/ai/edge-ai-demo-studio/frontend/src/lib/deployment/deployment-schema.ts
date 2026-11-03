// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** The `deployment.json` format as zod schemas; the reference docs' JSON Schema derives from them. */

import { z } from 'zod'
import { INSTANCE_ID_PATTERN } from '@/lib/instances/instances'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'
import { getEngineOptionsMap } from '@/services/config-registry'
import { getExecutionModes } from '@/services/execution'

export const MODEL_SOURCES = ['huggingface', 'modelscope', 'custom'] as const
export const INSTANCE_STATUSES = ['online', 'offline'] as const

export const DEPLOYMENT_SCHEMA_REF = './docs/deployment.schema.json'

export const modelEntryShape = {
  name: z.string().min(1).optional(),
  device: z.string().min(1).optional(),
  source: z.enum(MODEL_SOURCES).optional(),
  quant: z.string().optional(),
  params: z.string().optional(),
  backend: z.string().optional(),
  type: z.string().optional(),
}

const modelOverrideSchema = z.object(modelEntryShape).strict()

export const labelSchema = z.string().trim().min(1)
const statusSchema = z.enum(INSTANCE_STATUSES)

const instanceSettingsSchema = z.object({
  label: labelSchema.optional(),
  status: statusSchema.optional(),
  engine: z.string().optional(),
  models: z.record(z.string(), modelOverrideSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

/** One instance of the keyed form's `instances` map, named by its key. */
const instanceOverrideSchema = instanceSettingsSchema.strict()

/** An instance's id (`/api/<type>@<id>`), fixed at creation: renaming changes only the label. */
export const instanceIdSchema = z.string().regex(INSTANCE_ID_PATTERN)

/** One entry of a `services.<type>` list; matched by `instanceId`, else by `label`. */
const instanceEntrySchema = instanceSettingsSchema
  .extend({ instanceId: instanceIdSchema.optional() })
  .strict()

/** The older keyed `services.<type>` object, still read: its own fields are the first instance. */
const keyedServiceOverrideSchema = instanceSettingsSchema
  .extend({
    /** Ignored: ports are allocated at start. */
    port: z.number().int().min(1).max(65535).optional(),
    instances: z.record(z.string(), instanceOverrideSchema).optional(),
  })
  .strict()

const serviceOverrideSchema = z.union([
  z.array(instanceEntrySchema).min(1),
  keyedServiceOverrideSchema,
])

/**
 * Lenient where per-service rules are advisory (unknown model or type): those are warned about
 * entry by entry while applying, instead of rejecting the whole file.
 */
export const deploymentConfigSchema = z
  .object({
    $schema: z.string().optional(),
    services: z.record(z.string(), serviceOverrideSchema),
  })
  .strict()

export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>
export type InstanceSettings = z.infer<typeof instanceSettingsSchema>
export type InstanceEntry = z.infer<typeof instanceEntrySchema>
export type ServiceOverride = z.infer<typeof serviceOverrideSchema>

/** The service's execution modes that are user-pickable engines (`none` is internal). */
export function selectableEngines(
  serviceType: Service['type'],
): Service['engine'][] {
  const validEngines = getEngineOptionsMap().map((o) => o.value)
  return getExecutionModes(metaMap[serviceType].execution).flatMap((mode) =>
    validEngines.filter((engine) => engine === mode),
  )
}

/** Services without a model concept store a placeholder model row that is never exported. */
export function hasModelConfig(serviceType: Service['type']): boolean {
  const meta = metaMap[serviceType]
  return Boolean(meta.defaultModel || meta.config?.availableModels?.length)
}
