// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import { metaMap } from '@/services/_generated/meta'
import { getEngineOptionsMap } from '@/services/config-registry'
import {
  getExecutionModes,
  type ServiceMeta,
  supportsCustomModels,
} from '@/services/types'
import { Services } from '@/payload/collections/Services'
import { logger } from './logger'

/**
 * Generates the deployment.json reference documentation from the live
 * service registries so it never drifts from the code:
 *   docs/deployment-config.md    — human-readable reference
 *   docs/deployment.schema.json  — JSON Schema for editor autocompletion
 *
 * Runs on every startup (payload onInit) and only rewrites the files
 * when their content changed.
 */

const STATUS_VALUES = ['online', 'offline'] as const

/** Metadata keys that only apply to specific services; unlisted keys apply to all. */
const METADATA_KEY_SCOPE: Record<string, string[]> = {
  frameGeneration: ['lipsync'],
}

/** Metadata property descriptions pulled from the Services collection schema. */
function getMetadataProperties(
  serviceType?: string,
): Record<string, { description?: string }> {
  const field = Services.fields.find(
    (f) => 'name' in f && f.name === 'metadata',
  )
  if (field && field.type === 'json' && field.jsonSchema) {
    const schema = field.jsonSchema.schema as {
      properties?: Record<string, { description?: string }>
    }
    const properties = schema.properties ?? {}
    if (!serviceType) return properties
    return Object.fromEntries(
      Object.entries(properties).filter(
        ([key]) =>
          !METADATA_KEY_SCOPE[key] ||
          METADATA_KEY_SCOPE[key].includes(serviceType),
      ),
    )
  }
  return {}
}

/** Engines a service can run on ('none' is internal and not selectable). */
function getAllowedEngines(meta: ServiceMeta): string[] {
  const validEngines = getEngineOptionsMap().map((o) => o.value as string)
  return getExecutionModes(meta.execution).filter((m) =>
    validEngines.includes(m),
  )
}

// ─── JSON Schema ──────────────────────────────────────────────────

function buildModelSchema(meta: ServiceMeta, isDefault: boolean): object {
  const config = meta.config
  const modelNames = config?.availableModels?.map((m) => m.value) ?? []
  const devices = config?.availableDevices ?? []

  const nameSchema: Record<string, unknown> = {
    type: 'string',
    description: 'Model identifier (e.g. Hugging Face repo id)',
  }
  // Only constrain the model list when custom models are not supported.
  if (isDefault && modelNames.length > 0) {
    if (supportsCustomModels(config)) {
      nameSchema.examples = modelNames
    } else {
      nameSchema.enum = modelNames
    }
  }

  const deviceSchema: Record<string, unknown> = {
    type: 'string',
    description: 'Accelerator to run on (e.g. CPU, GPU, NPU)',
  }
  if (isDefault && devices.length > 0) {
    deviceSchema.examples = devices
  }

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: nameSchema,
      device: deviceSchema,
      source: { type: 'string', enum: ['huggingface', 'modelscope', 'custom'] },
      quant: {
        type: 'string',
        description: 'Weight format / quantization',
        ...(config?.availableWeightFormats?.length
          ? { examples: config.availableWeightFormats }
          : {}),
      },
      params: { type: 'string' },
      backend: { type: 'string' },
      type: { type: 'string' },
    },
  }
}

function buildServiceSchema(meta: ServiceMeta): object {
  const engines = getAllowedEngines(meta)
  const metadataProperties = getMetadataProperties(meta.id)

  return {
    type: 'object',
    additionalProperties: false,
    description: meta.description,
    properties: {
      status: {
        type: 'string',
        enum: [...STATUS_VALUES],
        description:
          "'online' starts the service when the app boots; 'offline' (default) leaves it stopped.",
      },
      ...(engines.length > 0
        ? {
            engine: {
              type: 'string',
              enum: engines,
              description: 'Execution engine for this service',
            },
          }
        : {}),
      port: {
        type: 'integer',
        minimum: 1,
        maximum: 65535,
        description: `Port to expose the service on (default: ${meta.port ?? 'none'})`,
      },
      models: {
        type: 'object',
        description:
          "Partial per-model overrides, merged over the defaults. 'default' is the primary model.",
        properties: {
          default: buildModelSchema(meta, true),
        },
        additionalProperties: buildModelSchema(meta, false),
      },
      metadata: {
        type: 'object',
        description: 'Service metadata, merged over existing values',
        properties: metadataProperties,
      },
    },
  }
}

export function buildDeploymentJsonSchema(): object {
  const serviceProperties: Record<string, object> = {}
  for (const [type, meta] of Object.entries(metaMap)) {
    serviceProperties[type] = buildServiceSchema(meta)
  }

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Edge AI Demo Studio deployment presets (deployment.json)',
    description:
      'Preset service configuration applied on startup, overriding the seeded defaults. See docs/deployment-config.md.',
    type: 'object',
    additionalProperties: false,
    required: ['services'],
    properties: {
      $schema: { type: 'string' },
      services: {
        type: 'object',
        additionalProperties: false,
        description: 'Service overrides keyed by service type',
        properties: serviceProperties,
      },
    },
  }
}

// ─── Markdown ─────────────────────────────────────────────────────

function code(value: string): string {
  return `\`${value}\``
}

function buildServiceSection(type: string, meta: ServiceMeta): string {
  const config = meta.config
  const engines = getAllowedEngines(meta)
  const lines: string[] = []

  lines.push(`### ${code(type)} — ${meta.name}`)
  lines.push('')
  lines.push(meta.description)
  lines.push('')
  lines.push('| Field | Value |')
  lines.push('| --- | --- |')
  lines.push(`| Default port | ${meta.port ?? '—'} |`)
  lines.push(
    `| Engines | ${engines.length ? engines.map(code).join(', ') : '—'} |`,
  )
  lines.push(
    `| Default model | ${
      meta.defaultModel
        ? `${code(meta.defaultModel.name)} on ${code(meta.defaultModel.device)}`
        : '—'
    } |`,
  )
  lines.push(
    `| Devices | ${
      config?.availableDevices?.length
        ? config.availableDevices.map(code).join(', ')
        : '—'
    } |`,
  )
  lines.push(
    `| Custom models | ${supportsCustomModels(config) ? 'yes' : 'no'} |`,
  )
  if (config?.availableWeightFormats?.length) {
    lines.push(
      `| Weight formats (\`quant\`) | ${config.availableWeightFormats
        .map(code)
        .join(', ')} |`,
    )
  }
  if (config?.availableModelSources?.length) {
    lines.push(
      `| Model sources | ${config.availableModelSources
        .map((s) => code(s.value))
        .join(', ')} |`,
    )
  }
  lines.push(`| Supported OS | ${meta.supportedOS.map(code).join(', ')} |`)

  if (config?.availableModels?.length) {
    lines.push('')
    lines.push('Known models:')
    lines.push('')
    lines.push('| Model (`models.default.name`) | Devices | Backend |')
    lines.push('| --- | --- | --- |')
    for (const model of config.availableModels) {
      lines.push(
        `| ${code(model.value)} | ${
          model.availableDevices?.length
            ? model.availableDevices.map(code).join(', ')
            : '—'
        } | ${model.backend ? code(model.backend) : '—'} |`,
      )
    }
  }

  lines.push('')
  return lines.join('\n')
}

export function buildDeploymentMarkdown(): string {
  const metadataProperties = getMetadataProperties()
  const lines: string[] = []

  lines.push('<!-- THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY. -->')
  lines.push(
    '<!-- Source of truth: frontend/src/lib/deployment-docs.ts (regenerated on app startup) -->',
  )
  lines.push('')
  lines.push('# Deployment Presets (`deployment.json`)')
  lines.push('')
  lines.push(
    'Place a `deployment.json` file in the project root (next to `setup.sh`) to preset',
  )
  lines.push(
    'service configuration instead of using the built-in defaults. It is read every time',
  )
  lines.push(
    'the app starts: the default services are seeded first, then the presets in this file',
  )
  lines.push(
    'overwrite them. Services marked `"status": "online"` are started automatically',
  )
  lines.push(
    '(internally moved to `prepare`, so the worker/engine boots and health checks promote',
  )
  lines.push('it to `active`).')
  lines.push('')
  lines.push(
    'The file location can be overridden with the `DEPLOYMENT_CONFIG_PATH` environment variable.',
  )
  lines.push(
    'Add `"$schema": "./docs/deployment.schema.json"` for editor validation and autocompletion.',
  )
  lines.push('')
  lines.push('## Packaged (Electron) builds')
  lines.push('')
  lines.push(
    'The packaging scripts (`scripts/bash/package.sh` / `scripts/win/package.ps1`)',
  )
  lines.push(
    'bundle the project-root `deployment.json` (plus `docs/deployment.schema.json`)',
  )
  lines.push(
    'into the Electron package automatically, so presets set before packaging ship',
  )
  lines.push(
    'with the app. Inside the packaged app the file lives in the `resources`',
  )
  lines.push('directory next to the bundled frontend:')
  lines.push('')
  lines.push(
    '- Linux (zip): `EdgeAIDemoStudio/linux-unpacked/resources/deployment.json`',
  )
  lines.push(
    '- Windows (installer): `<install dir>\\resources\\deployment.json`',
  )
  lines.push('')
  lines.push(
    'To change the presets of an already packaged build, edit that file and',
  )
  lines.push(
    'restart the app; delete it to fall back to the built-in defaults. Setting',
  )
  lines.push(
    'the `DEPLOYMENT_CONFIG_PATH` environment variable before launching the app',
  )
  lines.push('overrides the bundled file.')
  lines.push('')
  lines.push('## Example')
  lines.push('')
  lines.push('```json')
  lines.push(
    JSON.stringify(
      {
        $schema: './docs/deployment.schema.json',
        services: {
          'text-generation': {
            status: 'online',
            models: {
              default: {
                name: 'OpenVINO/Qwen3.5-4B-int4-ov',
                device: 'GPU',
                backend: 'openvino',
              },
            },
          },
          'speech-to-text': {
            status: 'online',
            models: { default: { device: 'NPU' } },
          },
          'text-to-speech': {
            status: 'offline',
            metadata: { languageCode: 'en-us' },
          },
        },
      },
      null,
      2,
    ),
  )
  lines.push('```')
  lines.push('')
  lines.push(
    'Model overrides are merged over the seeded defaults, which vary by OS: on',
  )
  lines.push(
    'Windows the default `text-generation`/`embeddings`/`rerank` backend is',
  )
  lines.push(
    '`llamacpp`, on Linux it is `openvino` (OVMS). When overriding `models.default.name`,',
  )
  lines.push(
    'always set `models.default.backend` to match the model — otherwise the inherited',
  )
  lines.push(
    'backend is kept and may fail to load the new model (e.g. llama.cpp cannot run',
  )
  lines.push('an OpenVINO model).')
  lines.push('')
  lines.push('## Fields')
  lines.push('')
  lines.push(
    'Every entry under `services` is keyed by the service type (see the reference below) and supports:',
  )
  lines.push('')
  lines.push('| Field | Type | Description |')
  lines.push('| --- | --- | --- |')
  lines.push(
    '| `status` | `"online"` \\| `"offline"` | `online` auto-starts the service on boot; `offline` (default) leaves it stopped |',
  )
  lines.push(
    '| `engine` | string | Execution engine — only for services listing more than one engine |',
  )
  lines.push('| `port` | integer | Overrides the default port |')
  lines.push(
    '| `models` | object | Partial per-model overrides merged over the defaults; `models.default` is the primary model (`name`, `device`, `source`, `quant`, `params`, `backend`, `type`) |',
  )
  lines.push(
    '| `metadata` | object | Merged over the existing service metadata |',
  )
  lines.push('')
  lines.push('Metadata keys:')
  lines.push('')
  lines.push('| Key | Description |')
  lines.push('| --- | --- |')
  for (const [name, prop] of Object.entries(metadataProperties)) {
    lines.push(`| ${code(name)} | ${prop.description ?? '—'} |`)
  }
  lines.push('')
  lines.push('## Service reference')
  lines.push('')
  for (const [type, meta] of Object.entries(metaMap)) {
    lines.push(buildServiceSection(type, meta))
  }

  return `${lines.join('\n').trimEnd()}\n`
}

// ─── File generation ──────────────────────────────────────────────

function writeIfChanged(filePath: string, content: string): boolean {
  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8')
    : null
  if (existing === content) return false
  fs.writeFileSync(filePath, content, 'utf8')
  return true
}

/**
 * Writes docs/deployment-config.md and docs/deployment.schema.json in the
 * project root. Skips quietly when the docs directory is absent (e.g. in
 * packaged builds) — the docs ship with the repository.
 */
export function generateDeploymentDocs(): void {
  try {
    const docsDir = path.resolve(process.cwd(), '..', 'docs')
    if (!fs.existsSync(docsDir)) return

    const markdownChanged = writeIfChanged(
      path.join(docsDir, 'deployment-config.md'),
      buildDeploymentMarkdown(),
    )
    const schemaChanged = writeIfChanged(
      path.join(docsDir, 'deployment.schema.json'),
      `${JSON.stringify(buildDeploymentJsonSchema(), null, 2)}\n`,
    )

    if (markdownChanged || schemaChanged) {
      logger.log(
        '📝 Regenerated deployment.json docs (docs/deployment-config.md, docs/deployment.schema.json)',
      )
    }
  } catch (error) {
    logger.error('Failed to generate deployment.json docs:', error)
  }
}
