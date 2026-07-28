// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import type { BasePayload } from 'payload'
import { z } from 'zod'
import { getBackendByValue } from '@/engines/registry'
import type { Service } from '@/payload-types'
import { getEngineOptionsMap } from '@/services/config-registry'
import { supportsCustomModels } from '@/services/types'
import { metaMap } from '@/services/_generated/meta'
import { logger } from './logger'

const DEPLOYMENT_FILE_NAME = 'deployment.json'

const modelOverrideSchema = z
  .object({
    name: z.string().min(1).optional(),
    device: z.string().min(1).optional(),
    source: z.enum(['huggingface', 'modelscope', 'custom']).optional(),
    quant: z.string().optional(),
    params: z.string().optional(),
    backend: z.string().optional(),
    type: z.string().optional(),
  })
  .strict()

const serviceOverrideSchema = z
  .object({
    status: z.enum(['online', 'offline']).optional(),
    engine: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    models: z.record(z.string(), modelOverrideSchema).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const deploymentConfigSchema = z
  .object({
    $schema: z.string().optional(),
    services: z.record(z.string(), serviceOverrideSchema),
  })
  .strict()

export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>
export type ServiceOverride = z.infer<typeof serviceOverrideSchema>

// ─── Loading ──────────────────────────────────────────────────────

/** Candidate locations, first match wins. cwd is frontend/ in dev. */
function candidatePaths(): string[] {
  const fromEnv = process.env.DEPLOYMENT_CONFIG_PATH
  return [
    ...(fromEnv ? [path.resolve(fromEnv)] : []),
    path.resolve(process.cwd(), '..', DEPLOYMENT_FILE_NAME),
    path.resolve(process.cwd(), DEPLOYMENT_FILE_NAME),
  ]
}

export function loadDeploymentConfig(): {
  config: DeploymentConfig
  filePath: string
} | null {
  const filePath = candidatePaths().find((p) => fs.existsSync(p))
  if (!filePath) return null

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    logger.error(
      `deployment.json at ${filePath} is not valid JSON — ignoring it:`,
      error,
    )
    return null
  }

  const parsed = deploymentConfigSchema.safeParse(raw)
  if (!parsed.success) {
    logger.error(
      `deployment.json at ${filePath} failed validation — ignoring it:\n` +
        z.prettifyError(parsed.error),
    )
    return null
  }

  return { config: parsed.data, filePath }
}

// ─── Applying ─────────────────────────────────────────────────────

type ModelEntry = Service['models'][string]

function mergeModels(
  existing: Service['models'],
  overrides: NonNullable<ServiceOverride['models']>,
  serviceType: string,
): Service['models'] {
  const merged: Service['models'] = { ...existing }

  for (const [key, override] of Object.entries(overrides)) {
    const base: Partial<ModelEntry> = merged[key] ?? {}
    const entry = { ...base, ...override }

    // The Services collection requires name + device on every model entry.
    if (!entry.name) {
      logger.warn(
        `deployment.json: services.${serviceType}.models.${key} has no ` +
          `'name' and no stored default to inherit from — skipping this entry`,
      )
      continue
    }
    entry.device = (entry.device || 'CPU').toUpperCase()

    merged[key] = entry as ModelEntry
  }

  return merged
}

function validateOverride(
  serviceType: Service['type'],
  override: ServiceOverride,
): boolean {
  const meta = metaMap[serviceType]

  if (override.engine) {
    const validEngines = getEngineOptionsMap().map((o) => o.value)
    if (!validEngines.includes(override.engine as Service['engine'])) {
      logger.warn(
        `deployment.json: services.${serviceType}.engine "${override.engine}" ` +
          `is not one of [${validEngines.join(', ')}] — skipping this service`,
      )
      return false
    }
  }

  // Advisory only — custom models/devices are allowed for some services.
  const config = meta.config
  const defaultOverride = override.models?.default
  if (defaultOverride?.backend && !getBackendByValue(defaultOverride.backend)) {
    logger.warn(
      `deployment.json: services.${serviceType}.models.default.backend ` +
        `"${defaultOverride.backend}" is not a registered backend — the ` +
        `health check cannot be matched to it and the service will likely ` +
        `stay in 'prepare'`,
    )
  }
  if (defaultOverride?.name && config?.availableModels?.length) {
    const known = config.availableModels.some(
      (m) => m.value === defaultOverride.name,
    )
    if (!known && !supportsCustomModels(config)) {
      logger.warn(
        `deployment.json: services.${serviceType}.models.default.name ` +
          `"${defaultOverride.name}" is not in the known model list ` +
          `(see docs/deployment-config.md) — applying anyway`,
      )
    }
  }
  if (defaultOverride?.device && config?.availableDevices?.length) {
    const device = defaultOverride.device.toUpperCase()
    const known = config.availableDevices.some(
      (d) => d.toUpperCase() === device,
    )
    if (!known) {
      logger.warn(
        `deployment.json: services.${serviceType}.models.default.device ` +
          `"${defaultOverride.device}" is not in [${config.availableDevices.join(', ')}] ` +
          `— applying anyway`,
      )
    }
  }

  return true
}

/**
 * Applies deployment.json overrides to the seeded service records.
 * Must run after ensureServicesExist() so every service row exists, and
 * after inactivateServices() so a status change to 'prepare' reliably
 * fires the afterChange hook that starts the worker/engine (health
 * checks then promote it to 'active').
 */
export async function applyDeploymentConfig(
  payload: BasePayload,
): Promise<void> {
  const loaded = loadDeploymentConfig()
  if (!loaded) return

  const { config, filePath } = loaded
  logger.log(`🛠️  Applying deployment presets from ${filePath}`)

  for (const [type, override] of Object.entries(config.services)) {
    if (!(type in metaMap)) {
      logger.warn(
        `deployment.json: unknown service type "${type}" — valid types: ` +
          `${Object.keys(metaMap).join(', ')}`,
      )
      continue
    }
    const serviceType = type as Service['type']

    if (!validateOverride(serviceType, override)) continue

    const found = await payload.find({
      collection: 'services',
      where: { type: { equals: serviceType } },
      limit: 1,
    })
    const doc = found.docs[0]
    if (!doc) {
      logger.warn(
        `deployment.json: no database record for service "${type}" — skipping`,
      )
      continue
    }

    const data: Partial<Service> = {}
    if (override.models) {
      data.models = mergeModels(doc.models, override.models, type)

      const backend = (data.models.default as { backend?: string } | undefined)
        ?.backend
      const backendHealthCheck = backend
        ? getBackendByValue(backend)?.healthcheck
        : undefined
      if (
        backendHealthCheck &&
        JSON.stringify(backendHealthCheck) !== JSON.stringify(doc.healthCheck)
      ) {
        data.healthCheck = backendHealthCheck as Service['healthCheck']
        logger.log(
          `🛠️  deployment.json: switching ${type} health check to the ` +
            `"${backend}" backend`,
        )
      }
    }
    if (override.engine) {
      data.engine = override.engine as Service['engine']
    }
    if (override.port !== undefined) {
      data.port = override.port
    }
    if (override.metadata) {
      data.metadata = {
        ...(doc.metadata ?? {}),
        ...override.metadata,
      } as Service['metadata']
    }

    if (Object.keys(data).length > 0) {
      try {
        // Status is unchanged here, so the afterChange hook is a no-op.
        await payload.update({
          collection: 'services',
          id: doc.id,
          data,
        })
        logger.log(`🛠️  Applied deployment preset for ${type}`)
      } catch (error) {
        logger.error(
          `deployment.json: failed to apply preset for "${type}":`,
          error,
        )
        continue
      }
    }

    // 'online' → 'prepare' kicks off the service start via the afterChange
    // hook; the health checker flips it to 'active'. Deliberately NOT
    // awaited: this runs during payload's onInit, and the start hook itself
    // calls getPayload() (e.g. to read the HF token), which only resolves
    // after onInit returns — awaiting here would deadlock startup.
    if (override.status === 'online') {
      logger.log(`🛠️  deployment.json: auto-starting ${type}`)
      payload
        .update({
          collection: 'services',
          id: doc.id,
          data: { status: 'prepare', statusMessage: '' },
        })
        .catch((error) => {
          logger.error(
            `deployment.json: failed to auto-start "${type}":`,
            error,
          )
        })
    }
  }
}
