// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** "Save current deployment": the service rows as a `deployment.json` that reproduces them at boot. */

import fs from 'node:fs'
import type { BasePayload } from 'payload'
import { getDeploymentConfigWritePath } from '@/lib/deployment/deployment-file'
import {
  DEPLOYMENT_SCHEMA_REF,
  type DeploymentConfig,
  deploymentConfigSchema,
  hasModelConfig,
  type InstanceEntry,
  type InstanceSettings,
  modelEntryShape,
  selectableEngines,
} from '@/lib/deployment/deployment-schema'
import { getInstanceLabel } from '@/lib/instances/instances'
import { isRunningPayloadStatus } from '@/lib/instances/service-status'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'

/** A saved file: always the list form, one entry per instance. */
export interface DeploymentSnapshotConfig extends DeploymentConfig {
  $schema: string
  services: Record<string, InstanceEntry[]>
}

export interface DeploymentSnapshot {
  config: DeploymentSnapshotConfig
  /** Where "save" writes the file on this machine. */
  filePath: string
  /** A file already exists at `filePath` and would be overwritten. */
  exists: boolean
}

const MODEL_FIELDS = Object.keys(modelEntryShape)

function snapshotModels(
  models: Service['models'],
): NonNullable<InstanceSettings['models']> | undefined {
  const result: NonNullable<InstanceSettings['models']> = {}
  for (const [key, model] of Object.entries(models ?? {})) {
    if (!model?.name) continue
    const entry: Record<string, string> = {}
    for (const field of MODEL_FIELDS) {
      const value = (model as Record<string, unknown>)[field]
      if (typeof value === 'string' && value.length > 0) entry[field] = value
    }
    result[key] = entry
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function snapshotMetadata(
  metadata: Service['metadata'],
): Record<string, unknown> | undefined {
  const entries = Object.entries(metadata ?? {}).filter(
    ([, value]) => value !== undefined && value !== null && value !== '',
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function snapshotInstanceEntry(doc: Service): InstanceEntry {
  const settings: InstanceEntry = {
    label: getInstanceLabel(doc),
    instanceId: doc.instanceId,
    // Running (or booting) instances are saved as "online" so they auto-start.
    status: isRunningPayloadStatus(doc.status) ? 'online' : 'offline',
  }
  if (selectableEngines(doc.type).length > 1 && doc.engine) {
    settings.engine = doc.engine
  }
  if (hasModelConfig(doc.type)) {
    const models = snapshotModels(doc.models)
    if (models) settings.models = models
  }
  const metadata = snapshotMetadata(doc.metadata)
  if (metadata) settings.metadata = metadata
  return settings
}

/**
 * Each type's instances in creation order, with `instanceId` so the next boot (here or on a fresh
 * machine) keeps their addresses. Ports are not saved: they are allocated at start.
 */
function buildDeploymentConfig(services: Service[]): DeploymentSnapshotConfig {
  const byType = new Map<string, Service[]>()
  for (const doc of services) {
    if (!(doc.type in metaMap)) continue
    byType.set(doc.type, [...(byType.get(doc.type) ?? []), doc])
  }

  const entries = [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, docs]) => {
      const instances = [...docs].sort((a, b) => a.id - b.id)
      return [type, instances.map(snapshotInstanceEntry)] as const
    })

  const config: DeploymentSnapshotConfig = {
    $schema: DEPLOYMENT_SCHEMA_REF,
    services: Object.fromEntries(entries),
  }
  // What is saved must load again.
  deploymentConfigSchema.parse(config)
  return config
}

export async function snapshotDeploymentConfig(
  payload: BasePayload,
): Promise<DeploymentSnapshot> {
  const found = await payload.find({
    collection: 'services',
    pagination: false,
    overrideAccess: true,
  })
  const filePath = getDeploymentConfigWritePath()
  return {
    config: buildDeploymentConfig(found.docs),
    filePath,
    exists: fs.existsSync(filePath),
  }
}
