// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { REPO_ROOT } from '@/lib/constants'
import {
  DEPLOYMENT_SCHEMA_REF,
  INSTANCE_STATUSES,
  instanceIdSchema,
  labelSchema,
  modelEntryShape,
  selectableEngines,
} from '@/lib/deployment/deployment-schema'
import {
  DEFAULT_MAX_INSTANCES,
  INSTANCE_ID_PATTERN,
} from '@/lib/instances/instances'
import { metadataFieldsFor } from '@/lib/instances/service-metadata'
import { logger } from '@/lib/logger'
import { metaMap } from '@/services/_generated/meta'
import { supportsCustomModels } from '@/services/model-config'
import type { ServiceMeta } from '@/services/types'

/**
 * Generates docs/deployment-config.md and docs/deployment.schema.json from the service registries
 * and zod schemas, at every startup; files are rewritten only when their content changed.
 */

function getMaxInstances(meta: ServiceMeta): number {
  return meta.maxInstances ?? DEFAULT_MAX_INSTANCES
}

// JSON Schema

/** A model entry; the primary (`default`) slot lists the service's known models and devices. */
function buildModelSchema(meta: ServiceMeta, isPrimaryModel: boolean) {
  const config = meta.config
  const modelNames = isPrimaryModel
    ? (config?.availableModels?.map((m) => m.value) ?? [])
    : []
  const devices = isPrimaryModel ? (config?.availableDevices ?? []) : []
  const nameDescription = 'Model identifier (e.g. Hugging Face repo id)'

  // Only constrain the model list when custom models are not supported.
  const name =
    modelNames.length > 0 && !supportsCustomModels(config)
      ? z
          .enum(modelNames as [string, ...string[]])
          .optional()
          .meta({ description: nameDescription })
      : modelEntryShape.name.meta({
          description: nameDescription,
          ...(modelNames.length > 0 ? { examples: modelNames } : {}),
        })

  return z
    .object({
      ...modelEntryShape,
      name,
      device: modelEntryShape.device.meta({
        description: 'Accelerator to run on (e.g. CPU, GPU, NPU)',
        ...(devices.length > 0 ? { examples: devices } : {}),
      }),
      quant: modelEntryShape.quant.meta({
        description: config?.defaultWeightFormat
          ? `Weight format / quantization (precision the model is converted to; default ${config.defaultWeightFormat})`
          : 'Weight format / quantization',
        ...(config?.availableWeightFormats?.length
          ? { examples: config.availableWeightFormats }
          : {}),
      }),
    })
    .strict()
}

/** `metadata` for the service: the keys that apply to it (`SERVICE_METADATA_FIELDS`). */
function buildMetadataSchema(meta: ServiceMeta) {
  const shape: Record<string, z.ZodType> = {}
  for (const [key, field] of Object.entries(metadataFieldsFor(meta.id))) {
    const base =
      field.enum && field.enum.length > 0
        ? z.enum(field.enum as [string, ...string[]])
        : field.type === 'number'
          ? z.number()
          : field.type === 'boolean'
            ? z.boolean()
            : z.string()
    shape[key] = base.optional().meta({
      description: field.description,
      ...(field.default !== undefined ? { default: field.default } : {}),
    })
  }
  return z.object(shape).meta({
    id: `${meta.id}-metadata`,
    description: 'Instance metadata, merged over existing values',
  })
}

/** Settings every instance accepts: the first one and each extra instance. */
function buildInstanceSettingsShape(meta: ServiceMeta) {
  const engines = selectableEngines(meta.id)
  const models = z
    .object({ default: buildModelSchema(meta, true).optional() })
    .catchall(buildModelSchema(meta, false))
    .meta({
      id: `${meta.id}-models`,
      description:
        "Partial per-model overrides, merged over the instance's current settings (a new instance starts from the first instance's). 'default' is the primary model.",
    })

  return {
    status: z.enum(INSTANCE_STATUSES).optional().meta({
      description:
        "'online' starts the instance when the app boots; 'offline' (default) leaves it stopped.",
    }),
    ...(engines.length > 0
      ? {
          engine: z
            .enum(engines as [string, ...string[]])
            .optional()
            .meta({ description: 'Execution engine for this instance' }),
        }
      : {}),
    // Every instance form repeats these; the definitions hold them once.
    models: models.optional(),
    metadata: buildMetadataSchema(meta).optional(),
  }
}

/** One instance of a `services.<type>` list; every entry after the first needs a label. */
function buildInstanceEntrySchema(
  meta: ServiceMeta,
  settings: ReturnType<typeof buildInstanceSettingsShape>,
  isFirst: boolean,
) {
  const label = labelSchema.meta({
    description: isFirst
      ? `Display name of the first instance, unique per service ("${meta.name}" when this file adds the service). A different name renames it, as in the UI: its address stays`
      : `Display name, unique per service (ignoring case). An entry without an instanceId is found again by it on every boot; a new instance's id is derived from it ("CPU fallback" → /api/${meta.id}@cpu-fallback). A different name renames a matched instance: its address stays`,
  })
  const instanceId = instanceIdSchema.optional().meta({
    description: `The instance's id, which its address is built on (/api/${meta.id}@<instanceId>); 1–32 lowercase letters, digits or dashes, starting and ending with a letter or digit. Saved deployments write it. It finds the same instance on every boot ahead of the label, even after a rename, and a missing instance is created under it`,
  })
  return z
    .object({
      label: isFirst ? label.optional() : label,
      instanceId,
      ...settings,
    })
    .strict()
}

/** The older `services.<type>` object, still read. */
function buildKeyedServiceSchema(
  meta: ServiceMeta,
  settings: ReturnType<typeof buildInstanceSettingsShape>,
) {
  const max = getMaxInstances(meta)
  const extraInstance = z
    .object({
      label: labelSchema.optional().meta({
        description:
          'Display name of the instance, unique per service (defaults to the instance id)',
      }),
      ...settings,
    })
    .strict()
    .meta({
      description: `An extra ${meta.name} instance, keyed by its instance id (the address becomes /api/${meta.id}@<id>)`,
    })

  return z
    .object({
      label: labelSchema.optional().meta({
        description: `Display name of the first instance, unique per service ("${meta.name}" when this file adds the service). A different name renames it: its address stays`,
      }),
      ...settings,
      port: z.number().int().min(1).max(65535).optional().meta({
        description:
          'Ignored — ports are allocated from INSTANCE_PORT_RANGE when the service starts',
      }),
      ...(meta.multiInstance
        ? {
            instances: z
              .record(z.string().regex(INSTANCE_ID_PATTERN), extraInstance)
              .optional()
              .meta({
                maxProperties: Math.max(0, max - 1),
                description:
                  `Extra ${meta.name} instances keyed by instance id (1–32 lowercase letters, digits or dashes, starting and ending with a letter or digit; a key equal to the first instance's id is ignored). ` +
                  `Each is created on startup if missing and copies the first instance's settings before its own overrides apply. ` +
                  `At most ${max} instances in total, the first included. Instances missing from this file are deleted.`,
              }),
          }
        : {}),
    })
    .strict()
    .meta({
      description: `Older form, still read: the fields configure the first ${meta.name} instance. Saving from the UI writes the list form.`,
    })
}

function buildServiceSchema(meta: ServiceMeta) {
  const max = meta.multiInstance ? getMaxInstances(meta) : 1
  const settings = buildInstanceSettingsShape(meta)
  const list = z
    .tuple(
      [buildInstanceEntrySchema(meta, settings, true)],
      buildInstanceEntrySchema(meta, settings, false),
    )
    .check(z.maxLength(max))
    .meta({
      description: meta.multiInstance
        ? `${meta.name} instances, first instance first (at most ${max}). Each entry is matched to an instance by its instanceId, then by its label; the first entry falls back to the service's oldest instance. A matched instance is updated in place (a new label renames it, its address stays); any other entry is created as a copy of the first instance. Instances no entry matches are deleted.`
        : `The ${meta.name} instance (a single-instance service: one entry).`,
    })
  return z
    .union([list, buildKeyedServiceSchema(meta, settings)])
    .meta({ description: meta.description })
}

function buildDeploymentJsonSchema(): object {
  const services: Record<string, z.ZodType> = {}
  for (const [type, meta] of Object.entries(metaMap)) {
    services[type] = buildServiceSchema(meta).optional()
  }

  const document = z
    .object({
      $schema: z.string().optional(),
      services: z
        .object(services)
        .strict()
        .meta({ description: 'Service overrides keyed by service type' }),
    })
    .strict()
    .meta({
      title: 'Edge AI Demo Studio deployment presets (deployment.json)',
      description:
        'Preset service configuration applied on startup, overriding the seeded defaults. See docs/deployment-config.md.',
    })

  return z.toJSONSchema(document, { target: 'draft-07', io: 'input' })
}

// Markdown

function code(value: string): string {
  return `\`${value}\``
}

function buildServiceSection(type: string, meta: ServiceMeta): string {
  const config = meta.config
  const engines = selectableEngines(meta.id)
  const lines: string[] = []

  lines.push(`### ${code(type)} — ${meta.name}`)
  lines.push('')
  lines.push(meta.description)
  lines.push('')
  lines.push('| Field | Value |')
  lines.push('| --- | --- |')
  lines.push(
    '| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |',
  )
  lines.push(
    `| Instances | ${
      meta.multiInstance
        ? `up to ${getMaxInstances(meta)} in total`
        : 'single instance only (later entries are ignored)'
    } |`,
  )
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
        .join(', ')}${
        config.defaultWeightFormat
          ? ` (default ${code(config.defaultWeightFormat)})`
          : ''
      } |`,
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

function buildDeploymentMarkdown(): string {
  const metadataProperties = metadataFieldsFor()
  const lines: string[] = []

  lines.push('<!-- THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY. -->')
  lines.push(
    '<!-- Source of truth: frontend/src/lib/deployment/deployment-docs.ts and deployment-schema.ts (regenerated on app startup) -->',
  )
  lines.push('')
  lines.push('# Deployment Presets (`deployment.json`)')
  lines.push('')
  lines.push(
    'Place a `deployment.json` file in the project root (next to `setup.sh`) to define the',
    'services the app runs instead of adding them by hand. Start from',
    '`deployment.example.json`: the repository ships no `deployment.json`, and without one',
    'nothing is applied — services are added and configured in the UI and kept as they are.',
  )
  lines.push('')
  lines.push(
    'When the file exists it is the **whole setup**, applied every time the app starts: the',
    'services it lists get exactly the instances it lists — a service nobody added is',
    'added from its defaults — and **everything else is removed**: an instance that is not',
    'listed is deleted like Delete on the Services page (its data directory goes with it),',
    'and a service that is not listed goes back to not added. Changes made in the UI',
    'therefore last only until the next start unless the deployment is saved again (see',
    'below). A file that fails validation is ignored as a whole and changes nothing.',
  )
  lines.push('')
  lines.push(
    'Services marked `"status": "online"` are started automatically (internally moved to',
    '`prepare`, so the worker/engine boots and health checks promote it to `active`).',
  )
  lines.push('')
  lines.push(
    'The file location can be overridden with the `DEPLOYMENT_CONFIG_PATH` environment variable.',
  )
  lines.push(
    'Add `"$schema": "./docs/deployment.schema.json"` for editor validation and autocompletion.',
  )
  lines.push('')
  lines.push(
    'You do not have to write the file by hand: **Settings → Deployment → Save current',
  )
  lines.push(
    "deployment…** in the web UI snapshots every instance's name, id, engine, model,",
  )
  lines.push(
    'device and metadata into this format (ports are allocated when a service starts',
  )
  lines.push(
    'and are not saved), marks the services that are running as `"online"`, and lets',
  )
  lines.push(
    'you either download the file or save it straight to the location the app reads',
  )
  lines.push('on startup.')
  lines.push('')
  lines.push('## Packaged (Electron) builds')
  lines.push('')
  lines.push(
    'The packaging scripts (`scripts/bash/package.sh` / `scripts/win/package.ps1`)',
  )
  lines.push(
    'bundle the project-root `deployment.json`, when there is one, and',
    '`deployment.example.json` (plus `docs/deployment.schema.json`)',
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
    'restart the app; delete it to stop applying presets. Copy the bundled',
    '`deployment.example.json` next to it to start one. Setting',
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
        $schema: DEPLOYMENT_SCHEMA_REF,
        services: {
          'text-generation': [
            {
              label: 'Text Generation',
              status: 'online',
              models: {
                default: {
                  name: 'OpenVINO/Qwen3.5-4B-int4-ov',
                  device: 'GPU',
                  backend: 'openvino',
                },
              },
            },
          ],
          'speech-to-text': [
            { status: 'online', models: { default: { device: 'NPU' } } },
          ],
          'text-to-speech': [
            { status: 'offline', metadata: { languageCode: 'en-us' } },
          ],
        },
      },
      null,
      2,
    ),
  )
  lines.push('```')
  lines.push('')
  lines.push(
    'Every entry under `services` is keyed by the service type and lists that service’s',
    'instances, first instance first. The first entry configures the **first instance**',
    '(the one created with the app); services that support several instances can list',
    'more (see [Multiple instances](#multiple-instances)).',
  )
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
  lines.push('Every instance in a `services.<type>` list supports:')
  lines.push('')
  lines.push('| Field | Type | Description |')
  lines.push('| --- | --- | --- |')
  lines.push(
    '| `label` | string | Display name shown in the UI, unique per service (ignoring case). Optional on the first entry, which keeps its current name without it (the service’s own name when this file adds the service); required on every later entry, which an entry without `instanceId` is found by. A different name renames the instance it matches; its address stays |',
  )
  lines.push(
    '| `instanceId` | string | The instance’s id, which its address is built on: `/api/<type>@<instanceId>` (1–32 lowercase letters, digits or dashes, starting and ending with a letter or digit). Optional; saved deployments write it. An entry with an id finds the same instance on every boot even after it was renamed, and a missing instance is created under that id. Without one, a new instance’s id is derived from its name: `"CPU fallback"` → `cpu-fallback` |',
  )
  lines.push(
    '| `status` | `"online"` \\| `"offline"` | `online` auto-starts the instance on boot; `offline` (default) leaves it stopped |',
  )
  lines.push(
    '| `engine` | string | Execution engine — only for services listing more than one engine |',
  )
  lines.push(
    '| `models` | object | Partial per-model overrides merged over the current settings; `models.default` is the primary model (`name`, `device`, `source`, `quant`, `params`, `backend`, `type`) |',
  )
  lines.push(
    '| `metadata` | object | Merged over the existing instance metadata |',
  )
  lines.push('')
  lines.push('Metadata keys:')
  lines.push('')
  lines.push('| Key | Description |')
  lines.push('| --- | --- |')
  for (const [name, prop] of Object.entries(metadataProperties)) {
    lines.push(`| ${code(name)} | ${prop.description} |`)
  }
  lines.push('')
  lines.push('## Multiple instances')
  lines.push('')
  lines.push(
    'A multi-instance service (see the `Instances` row of each service below) can run',
  )
  lines.push(
    'several instances at once — for example one Text Generation on the GPU and a',
  )
  lines.push('second one on the CPU. Every instance answers at')
  lines.push(
    '`/api/<type>@<instanceId>` and has its own model, device, port, process, logs and',
  )
  lines.push(
    'data directory. There is no bare `/api/<type>` address; samples use whichever instance',
  )
  lines.push(
    'is running. A new instance’s id is derived from its name (Text Generation →',
    '`text-generation`) and never changes after: renaming an instance — in the UI or in',
    'this file — changes only its name, so its address, data directory and sample',
    'bindings stay.',
  )
  lines.push('')
  lines.push('```json')
  lines.push(
    JSON.stringify(
      {
        $schema: DEPLOYMENT_SCHEMA_REF,
        services: {
          'text-generation': [
            {
              label: 'Text Generation',
              instanceId: 'text-generation',
              status: 'online',
              models: {
                default: {
                  name: 'OpenVINO/Qwen3.5-4B-int4-ov',
                  device: 'GPU',
                  backend: 'openvino',
                },
              },
            },
            {
              label: 'CPU fallback',
              status: 'online',
              models: { default: { device: 'CPU' } },
            },
            {
              label: 'Small model',
              status: 'offline',
              models: {
                default: {
                  name: 'Qwen/Qwen3-1.7B-GGUF',
                  device: 'CPU',
                  backend: 'llamacpp',
                },
              },
            },
          ],
        },
      },
      null,
      2,
    ),
  )
  lines.push('```')
  lines.push('')
  lines.push('On every startup, for each `services.<type>` list:')
  lines.push('')
  lines.push(
    '- **Every entry is matched to one of the service’s instances by its `instanceId`**,',
    '  when it has one, **then by its `label`** (ignoring case). A matched instance is',
    '  **updated** in place: the overrides are merged over its current settings, and a',
    '  different `label` renames it — only its name: its address, data and sample',
    '  bindings stay, as when it is renamed in the UI.',
    '- The **first entry**, when neither matches, configures the service’s oldest',
    '  remaining instance, so giving the first instance a new name in the file renames',
    '  it rather than replacing it.',
    '- Any other entry that matches nothing is **created**: it copies the first instance’s',
    '  engine, models, health check and metadata — after this file’s presets for the',
    '  first instance have been applied — then its own `models` / `metadata` / `engine`',
    '  overrides are merged on top. It is created under the entry’s `instanceId`, or an id',
    '  derived from its name (`"Small model"` → `/api/text-generation@small-model`). So',
    '  `{ "label": "CPU fallback", "models": { "default": { "device": "CPU" } } }` is enough',
    '  for a second instance of the same model on another accelerator.',
    '- A later entry without an `instanceId` is found by its name alone, so changing its',
    '  `label` in the file creates a new instance under the new name and deletes the old',
    '  one with its data. To rename it and keep everything, add the instance’s',
    '  `instanceId` to the entry — a saved deployment has it — or rename the instance in',
    '  the UI and save the deployment again.',
    '- Instances no entry matches are **deleted**, before anything is created: the file’s',
    '  count is the count you get. Matched instances are updated before new ones are',
    '  created, so a new instance can take a name an existing one gives up.',
    '- `"status": "online"` auto-starts the instance. Instances of one service start one',
    '  after another, in list order; different services start in parallel.',
    '- Names are unique per service (ignoring case) and an id names one instance: a later',
    '  entry without a `label`, an entry naming an `instanceId` an earlier entry already',
    '  names, or a new instance whose name is taken is ignored, and an instance renamed',
    '  onto a sibling’s name keeps its own — each with a warning in the app log. A file',
    '  with an `instanceId` that is not 1–32 lowercase letters, digits or dashes,',
    '  starting and ending with a letter or digit, fails validation.',
    '- Each service has a cap on instances (see its `Instances` row); instances beyond',
    '  the cap are skipped with a warning in the app log. Later entries for a',
    '  single-instance service are ignored with a warning.',
  )
  lines.push('')
  lines.push('### Older files')
  lines.push('')
  lines.push(
    'Files saved before the list form keep working. There, `services.<type>` is an object:',
    'its own fields (plus an ignored `port`) configure the first instance, and',
    '`instances.<instanceId>` declares extra ones keyed by their address id, which never',
    'changes; such an entry’s `label` is optional and defaults to the id. A different',
    '`label` renames an instance; its address stays. Instances and services such a file',
    'does not declare are removed the same way. Saving the deployment from the UI writes',
    'the list form.',
  )
  lines.push('')
  lines.push('## Service reference')
  lines.push('')
  for (const [type, meta] of Object.entries(metaMap)) {
    lines.push(buildServiceSection(type, meta))
  }

  return `${lines.join('\n').trimEnd()}\n`
}

// File generation

function writeIfChanged(filePath: string, content: string): boolean {
  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8')
    : null
  if (existing === content) return false
  fs.writeFileSync(filePath, content, 'utf8')
  return true
}

/** Skips quietly when `docs/` is absent (packaged builds): the docs ship with the repository. */
export function generateDeploymentDocs(): void {
  try {
    const docsDir = path.join(REPO_ROOT, 'docs')
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
