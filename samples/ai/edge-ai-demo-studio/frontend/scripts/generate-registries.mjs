#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Discovers service, sample and engine folders and writes their _generated/ registries, keyed by
 * folder name. Services and samples need data.ts (exporting `service` / `sample`); engines need a
 * client-safe data.ts (`engine`) and server.ts (the EngineServer members). Run: npm run codegen
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const print = (line) => process.stdout.write(`${line}\n`)
// Piped into a reader that stopped early (`| head`): nothing left to say.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0)
  throw error
})

const _dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = join(_dirname, '..', 'src')

// Common helpers

const SKIP = new Set(['common', '_generated'])

const GROUP_FOLDERS = new Set(['suites'])
const HEADER = [
  '// Copyright (C) 2026 Intel Corporation',
  '// SPDX-License-Identifier: Apache-2.0',
  '',
  '// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.',
  '// Source of truth: scripts/generate-registries.mjs',
  '// Run "npm run codegen" to regenerate.',
  '',
]

/** Quote a folder name as an object key when necessary */
function key(folder) {
  return /[^a-zA-Z0-9_$]/.test(folder) ? `"${folder}"` : folder
}

function toCamel(folder) {
  return folder.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

/** Parse the first exported function/const component name from a file */
function parseDemoExport(filePath) {
  const src = readFileSync(filePath, 'utf8')
  const m = src.match(/export\s+(?:function|const)\s+(\w+)/)
  if (!m) {
    throw new Error(`No exported component found in ${filePath}`)
  }
  return m[1]
}

function isValidIdentifier(name) {
  return typeof name === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
}

function isWhitespace(ch) {
  return (
    ch === ' ' ||
    ch === '\t' ||
    ch === '\n' ||
    ch === '\r' ||
    ch === '\f' ||
    ch === '\v'
  )
}

function isIdentStart(ch) {
  return (
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= 'a' && ch <= 'z') ||
    ch === '_' ||
    ch === '$'
  )
}

function isIdentPart(ch) {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9')
}

/** Check if a data.ts file exports a specific const without constructing dynamic RegExp. */
function hasExport(filePath, name) {
  if (!isValidIdentifier(name)) return false
  const src = readFileSync(filePath, 'utf8')

  let idx = 0
  while (true) {
    idx = src.indexOf('export', idx)
    if (idx === -1) return false
    let j = idx + 6 // past 'export'
    while (j < src.length && isWhitespace(src[j])) j++
    if (src.startsWith('const', j)) {
      j += 5 // past 'const'
      while (j < src.length && isWhitespace(src[j])) j++
      if (j < src.length && isIdentStart(src[j])) {
        let k = j + 1
        while (k < src.length && isIdentPart(src[k])) k++
        const ident = src.slice(j, k)
        if (ident === name) return true
      }
    }
    idx = idx + 6
  }
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
}

function discoverLeafFolders(parentDir) {
  const found = []
  const seen = new Map()

  const pushLeaf = (name, importPath, dir) => {
    if (seen.has(name)) {
      throw new Error(
        `Duplicate folder key "${name}" found at ${importPath} and ${seen.get(name)}. ` +
          'Leaf folder names must be unique across services/samples.',
      )
    }
    seen.set(name, importPath)
    found.push({ key: name, importPath, dir })
  }

  for (const name of readdirSync(parentDir)) {
    if (SKIP.has(name)) continue
    const dir = join(parentDir, name)
    if (!statSync(dir).isDirectory()) continue

    if (GROUP_FOLDERS.has(name)) {
      // Descend exactly one level: <parent>/<group>/<suite>/<id>/data.ts
      for (const suite of readdirSync(dir)) {
        if (SKIP.has(suite)) continue
        const suiteDir = join(dir, suite)
        if (!statSync(suiteDir).isDirectory()) continue
        for (const leaf of readdirSync(suiteDir)) {
          if (SKIP.has(leaf)) continue
          const leafDir = join(suiteDir, leaf)
          if (!statSync(leafDir).isDirectory()) continue
          if (!existsSync(join(leafDir, 'data.ts'))) continue
          pushLeaf(leaf, `${name}/${suite}/${leaf}`, leafDir)
        }
      }
      continue
    }

    if (existsSync(join(dir, 'data.ts'))) {
      pushLeaf(name, name, dir)
    }
  }

  return found.sort((a, b) => a.key.localeCompare(b.key))
}

// Services

const servicesDir = join(srcDir, 'services')
const servicesGenDir = join(servicesDir, '_generated')
ensureDir(servicesGenDir)

const metaOutputPath = join(servicesGenDir, 'meta.ts')
const outputPath = join(servicesGenDir, 'services.ts')
const workerRegistryPath = join(servicesGenDir, 'workers.ts')
const docsRegistryPath = join(servicesGenDir, 'docs.ts')
const configurePanelRegistryPath = join(servicesGenDir, 'configure-panels.ts')
const featureProviderRegistryPath = join(servicesGenDir, 'feature-providers.ts')
const metricsRegistryPath = join(servicesGenDir, 'metrics.ts')
const inUseRegistryPath = join(servicesGenDir, 'in-use.ts')

function toAlias(folder) {
  return `${toCamel(folder)}Meta`
}

function resolveDemoPath(serviceDir) {
  const flat = join(serviceDir, 'demo.tsx')
  if (existsSync(flat)) return flat
  const nested = join(serviceDir, 'demo', 'index.tsx')
  if (existsSync(nested)) return nested
  return null
}

function resolveConfigurePanel(serviceDir, importPath) {
  const flat = join(serviceDir, 'configure-panel.tsx')
  if (existsSync(flat)) {
    return {
      filePath: flat,
      importPath: `../${importPath}/configure-panel`,
    }
  }

  const components = join(serviceDir, 'components', 'configure-panel.tsx')
  if (existsSync(components)) {
    return {
      filePath: components,
      importPath: `../${importPath}/components/configure-panel`,
    }
  }

  const demoComponents = join(
    serviceDir,
    'demo',
    'components',
    'configure-panel.tsx',
  )
  if (existsSync(demoComponents)) {
    return {
      filePath: demoComponents,
      importPath: `../${importPath}/demo/components/configure-panel`,
    }
  }

  return null
}

function resolveFeatureProvider(serviceDir, importPath) {
  const candidates = [
    ['feature-provider.tsx'],
    ['components', 'feature-provider.tsx'],
    ['demo', 'components', 'feature-provider.tsx'],
  ]
  for (const parts of candidates) {
    const filePath = join(serviceDir, ...parts)
    if (existsSync(filePath)) {
      return {
        filePath,
        importPath: `../${importPath}/${parts.join('/').replace(/\.tsx$/, '')}`,
      }
    }
  }
  return null
}

function resolveMetricFigures(serviceDir) {
  const filePath = join(serviceDir, 'metrics.tsx')
  if (!existsSync(filePath)) return false
  if (!hasExport(filePath, 'figures')) {
    throw new Error(`${filePath} must export const figures`)
  }
  return true
}

function resolveInUse(serviceDir) {
  const filePath = join(serviceDir, 'in-use.ts')
  if (!existsSync(filePath)) return false
  if (!/export\s+function\s+useInUse\b/.test(readFileSync(filePath, 'utf8'))) {
    throw new Error(`${filePath} must export function useInUse`)
  }
  return true
}

const services = discoverLeafFolders(servicesDir).map(
  ({ key: folderKey, importPath, dir: serviceDir }) => {
    const dataPath = join(serviceDir, 'data.ts')
    const demoPath = resolveDemoPath(serviceDir)
    const configurePanel = resolveConfigurePanel(serviceDir, importPath)
    const featureProvider = resolveFeatureProvider(serviceDir, importPath)

    return {
      key: folderKey,
      importPath,
      dir: serviceDir,
      dataAlias: toAlias(folderKey),
      demoExport: demoPath ? parseDemoExport(demoPath) : null,
      configurePanelExport: configurePanel
        ? parseDemoExport(configurePanel.filePath)
        : null,
      configurePanelImportPath: configurePanel?.importPath ?? null,
      featureProviderExport: featureProvider
        ? parseDemoExport(featureProvider.filePath)
        : null,
      featureProviderImportPath: featureProvider?.importPath ?? null,
      hasWorker: hasExport(dataPath, 'worker'),
      hasDocs: existsSync(join(serviceDir, 'docs.ts')),
      hasMetrics: resolveMetricFigures(serviceDir),
      hasInUse: resolveInUse(serviceDir),
    }
  },
)

// Service code generation

// _generated/meta.ts (no React/JSX deps)
const metaLines = [
  ...HEADER,
  ...services.map(
    ({ importPath, dataAlias }) =>
      `import { service as ${dataAlias} } from "../${importPath}/data";`,
  ),
  '',
  '/** Metadata-only map — safe to import in non-React/config contexts. */',
  'export const metaMap = {',
  ...services.map(({ key: k, dataAlias }) => `  ${key(k)}: ${dataAlias},`),
  '};',
  '',
]

writeFileSync(metaOutputPath, metaLines.join('\n'), 'utf8')

// _generated/services.ts (includes React demo components)
const lines = [
  ...HEADER,
  'import type { Service as ServiceType } from "@/payload-types";',
  '',
  '// Data imports',
  ...services.map(
    ({ importPath, dataAlias }) =>
      `import { service as ${dataAlias} } from "../${importPath}/data";`,
  ),
  '',
  '// Demo imports',
  ...services
    .filter((s) => s.demoExport)
    .map(
      ({ importPath, demoExport }) =>
        `import { ${demoExport} } from "../${importPath}/demo";`,
    ),
  '',
  'import type { Service } from "../types";',
  '',
  '/** Full service map including React demo components. */',
  'export const serviceMap: Record<ServiceType["type"], Service> = {',
  ...services.flatMap(({ key: k, dataAlias, demoExport }) => [
    `  ${key(k)}: {`,
    `    ...${dataAlias},`,
    '    status: "offline",',
    ...(demoExport ? [`    demo: ${demoExport},`] : []),
    '  },',
  ]),
  '};',
  '',
]

writeFileSync(outputPath, lines.join('\n'), 'utf8')

// _generated/configure-panels.ts (optional service configure panels)
const configurePanelServices = services.filter(
  (s) => s.configurePanelExport && s.configurePanelImportPath,
)

const configurePanelLines = [
  ...HEADER,
  'import type { ComponentType } from "react";',
  'import type { Service } from "../types";',
  '',
  ...configurePanelServices.map(
    ({ configurePanelExport, configurePanelImportPath }) =>
      `import { ${configurePanelExport} } from "${configurePanelImportPath}";`,
  ),
  '',
  'export type ServiceConfigurePanelComponent = ComponentType<{',
  '  service: Service;',
  '}>;',
  '',
  '/** Optional service-specific configure panel keyed by service ID. */',
  'export const configurePanelRegistry: Partial<Record<string, ServiceConfigurePanelComponent>> = {',
  ...configurePanelServices.map(
    ({ key: k, configurePanelExport }) =>
      `  ${key(k)}: ${configurePanelExport},`,
  ),
  '};',
  '',
]

writeFileSync(
  configurePanelRegistryPath,
  configurePanelLines.join('\n'),
  'utf8',
)

// _generated/feature-providers.ts (optional-service feature providers)
// Headless components a sample mounts for an optional service. A pruned service folder drops out
// of the map, leaving no static import (see docs/OPTIONAL-SERVICES.md).
const featureProviderServices = services.filter(
  (s) => s.featureProviderExport && s.featureProviderImportPath,
)

const featureProviderLines = [
  ...HEADER,
  'import type { ComponentType } from "react";',
  '',
  ...featureProviderServices.map(
    ({ featureProviderExport, featureProviderImportPath }) =>
      `import { ${featureProviderExport} } from "${featureProviderImportPath}";`,
  ),
  '',
  '/** Props every optional-service feature provider component accepts. */',
  'export interface FeatureProviderProps {',
  '  /** Called by speech-driven providers (STT) with recognized text. */',
  '  onTranscription?: (text: string) => void;',
  '  /** Host sample id (e.g. for service-specific config links). */',
  '  sampleId?: string;',
  '}',
  '',
  'export type FeatureProviderComponent = ComponentType<FeatureProviderProps>;',
  '',
  '/** Optional-service feature provider keyed by service ID. Looked up by',
  ' *  `useSampleChatFeatures`; a pruned service folder drops out automatically. */',
  'export const featureProviderRegistry: Partial<Record<string, FeatureProviderComponent>> = {',
  ...featureProviderServices.map(
    ({ key: k, featureProviderExport }) =>
      `  ${key(k)}: ${featureProviderExport},`,
  ),
  '};',
  '',
]

writeFileSync(
  featureProviderRegistryPath,
  featureProviderLines.join('\n'),
  'utf8',
)

// _generated/metrics.ts (Live metrics figures)
// A service's `metrics.tsx` lists the figures its demo's Live metrics panel
// shows; a service without one shows no panel.
const metricsServices = services.filter((s) => s.hasMetrics)

function toFiguresAlias(folder) {
  return `${toCamel(folder)}Figures`
}

const metricsLines = [
  ...HEADER,
  'import type { MetricFigure } from "../common/metrics/types";',
  '',
  ...metricsServices.map(
    ({ key: k, importPath }) =>
      `import { figures as ${toFiguresAlias(k)} } from "../${importPath}/metrics";`,
  ),
  '',
  "/** Figures of each service's Live metrics panel (`metrics.tsx`), keyed by service ID. */",
  'export const metricsRegistry: Partial<Record<string, MetricFigure[]>> = {',
  ...metricsServices.map(({ key: k }) => `  ${key(k)}: ${toFiguresAlias(k)},`),
  '};',
  '',
]

writeFileSync(metricsRegistryPath, metricsLines.join('\n'), 'utf8')

// _generated/in-use.ts (built-in services in use)
// A built-in service's `in-use.ts` (hook `useInUse`) says when something is set up in it, so the
// sidebar lists it. One hook calls them all unconditionally; a pruned service simply drops out.
const inUseServices = services.filter((s) => s.hasInUse)

function toInUseAlias(folder) {
  const camel = toCamel(folder)
  return `use${camel[0].toUpperCase()}${camel.slice(1)}InUse`
}

const inUseLines = [
  ...HEADER,
  ...inUseServices.map(
    ({ key: k, importPath }) =>
      `import { useInUse as ${toInUseAlias(k)} } from "../${importPath}/in-use";`,
  ),
  '',
  '/** Ids of the built-in services in use (`in-use.ts`), which the sidebar lists. */',
  'export function useServicesInUse(): string[] {',
  ...inUseServices.map(
    ({ key: k }) => `  const ${toCamel(k)} = ${toInUseAlias(k)}();`,
  ),
  '  return [',
  ...inUseServices.map(
    ({ key: k }) => `    ...(${toCamel(k)} ? ["${k}"] : []),`,
  ),
  '  ];',
  '}',
  '',
]

writeFileSync(inUseRegistryPath, inUseLines.join('\n'), 'utf8')

// _generated/proxied-services.ts (plain data for next.config.ts)
// next.config.ts is transpiled without the `@/` alias, so it can't load the service registry.

/** Execution modes from data.ts: `execution: { mode: 'worker' }` or `mode: ['multiserve', 'worker']`. */
function parseExecutionModes(dataPath) {
  const src = readFileSync(dataPath, 'utf8')
  const match = src.match(
    /execution\s*:\s*\{[\s\S]*?\bmode\s*:\s*(\[[^\]]*\]|['"][\w-]+['"])/,
  )
  if (!match) throw new Error(`${dataPath}: cannot read execution.mode`)
  return [...match[1].matchAll(/['"]([\w-]+)['"]/g)].map((m) => m[1])
}

const proxiedServiceKeys = services
  .filter((s) => !parseExecutionModes(join(s.dir, 'data.ts')).includes('none'))
  .map((s) => s.key)

const proxiedLines = [
  ...HEADER,
  '/** Service types whose worker traffic is proxied through `/api/<type>/*`:',
  " *  every type whose `execution.mode` is not `'none'`. Plain data, so",
  ' *  next.config.ts can read it without loading the service registry. */',
  'export const proxiedServiceTypes: readonly string[] = [',
  ...proxiedServiceKeys.map((k) => `  ${JSON.stringify(k)},`),
  '];',
  '',
]

writeFileSync(
  join(servicesGenDir, 'proxied-services.ts'),
  proxiedLines.join('\n'),
  'utf8',
)

// _generated/workers.ts (worker registry, no React deps)
const workerServices = services.filter((s) => s.hasWorker)

function toWorkerAlias(folder) {
  return `${toCamel(folder)}Worker`
}

const workerLines = [
  ...HEADER,
  'import type { Service } from "@/payload-types";',
  'import type { WorkerConfig } from "../types";',
  '',
  ...workerServices.map(
    ({ key: k, importPath }) =>
      `import { worker as ${toWorkerAlias(k)} } from "../${importPath}/data";`,
  ),
  '',
  '/** Worker configuration registry keyed by Payload service type. */',
  'const workerRegistry: Partial<Record<Service["type"], WorkerConfig>> = {',
  ...workerServices.map(({ key: k }) => `  ${key(k)}: ${toWorkerAlias(k)},`),
  '};',
  '',
  'export function getWorkerConfig(',
  '  type: Service["type"],',
  '): WorkerConfig | undefined {',
  '  return workerRegistry[type];',
  '}',
  '',
]

writeFileSync(workerRegistryPath, workerLines.join('\n'), 'utf8')

// _generated/docs.ts (docs factory registry)
const docsServices = services.filter((s) => s.hasDocs)

function toDocsAlias(folder) {
  return `${toCamel(folder)}Docs`
}

const docsLines = [
  ...HEADER,
  'import type { DocsFactoryOptions, ServiceDocsData } from "../types";',
  '',
  'export type DocsFactory = (opts: DocsFactoryOptions) => ServiceDocsData;',
  '',
  ...docsServices.map(
    ({ key: k, importPath }) =>
      `import { getDocsData as ${toDocsAlias(k)} } from "../${importPath}/docs";`,
  ),
  '',
  '/** Registry of docs factory functions keyed by service ID. */',
  'export const docsRegistry: Record<string, DocsFactory> = {',
  ...docsServices.map(({ key: k }) => `  ${key(k)}: ${toDocsAlias(k)},`),
  '};',
  '',
]

writeFileSync(docsRegistryPath, docsLines.join('\n'), 'utf8')

// Samples

const samplesDir = join(srcDir, 'samples')
const samplesGenDir = join(samplesDir, '_generated')
ensureDir(samplesGenDir)

const samplesOutputPath = join(samplesGenDir, 'samples.ts')

const sampleFolders = discoverLeafFolders(samplesDir)

const sampleLines = [
  ...HEADER,
  'import type { Sample } from "../types";',
  '',
  ...sampleFolders.map(
    ({ key: k, importPath }) =>
      `import { sample as ${toCamel(k)} } from "../${importPath}/data";`,
  ),
  '',
  '/** Auto-discovered sample map. */',
  'export const sampleMap: Record<string, Sample> = {',
  ...sampleFolders.map(({ key: k }) => `  ${key(k)}: ${toCamel(k)},`),
  '};',
  '',
]

writeFileSync(samplesOutputPath, sampleLines.join('\n'), 'utf8')

// Engines

const engineDir = join(srcDir, 'engines')
const engineGenDir = join(engineDir, '_generated')
ensureDir(engineGenDir)

const engineMetaOutputPath = join(engineGenDir, 'meta.ts')
const enginesOutputPath = join(engineGenDir, 'engines.ts')
const engineConfigurePanelsOutputPath = join(
  engineGenDir,
  'configure-panels.ts',
)

const engineFolders = readdirSync(engineDir)
  .filter((name) => {
    if (SKIP.has(name)) return false
    const dir = join(engineDir, name)
    return (
      statSync(dir).isDirectory() &&
      existsSync(join(dir, 'data.ts')) &&
      existsSync(join(dir, 'server.ts'))
    )
  })
  .sort()

/** The Runtime Settings panel exported from an engine's components/configure-panel/index.ts, or null. */
function parseEngineConfigurePanel(folder) {
  const indexPath = join(
    engineDir,
    folder,
    'components',
    'configure-panel',
    'index.ts',
  )
  if (!existsSync(indexPath)) return null
  const m = readFileSync(indexPath, 'utf8').match(/\b(\w*ConfigurePanel)\b/)
  return m ? m[1] : null
}

const engineEntries = engineFolders.map((folder) => ({
  folder,
  alias: toCamel(folder),
  configurePanel: parseEngineConfigurePanel(folder),
}))

// _generated/meta.ts (engines only, no handlers)
const engineMetaLines = [
  ...HEADER,
  'import type { Engine } from "../types";',
  '',
  ...engineEntries.map(
    ({ folder, alias }) =>
      `import { engine as ${alias} } from "../${folder}/data";`,
  ),
  '',
  '/** Auto-discovered engine map (metadata-only). */',
  'export const engines: Record<string, Engine> = {',
  ...engineEntries.map(({ folder, alias }) => `  ${key(folder)}: ${alias},`),
  '};',
  '',
]

writeFileSync(engineMetaOutputPath, engineMetaLines.join('\n'), 'utf8')

// _generated/engines.ts (server modules, server-only)
const engineLines = [
  ...HEADER,
  'import type { EngineServer } from "../types";',
  '',
  ...engineEntries.map(
    ({ folder, alias }) => `import * as ${alias} from "../${folder}/server";`,
  ),
  '',
  '/**',
  ' * Auto-discovered engine server modules, by engine id. Imported as',
  ' * namespaces, so nothing is read from them while modules evaluate: a',
  ' * start handler sits in an import cycle with the Payload config.',
  ' */',
  'export const engineServers: Record<string, EngineServer> = {',
  ...engineEntries.map(({ folder, alias }) => `  ${key(folder)}: ${alias},`),
  '};',
  '',
]

writeFileSync(enginesOutputPath, engineLines.join('\n'), 'utf8')

// _generated/configure-panels.ts (client: engine Runtime Settings panels)
const enginePanelEntries = engineEntries.filter((e) => e.configurePanel)
const engineConfigurePanelLines = [
  ...HEADER,
  'import type { ComponentType } from "react";',
  'import type { EngineConfigurePanelProps } from "../types";',
  '',
  ...enginePanelEntries.map(
    ({ folder, configurePanel }) =>
      `import { ${configurePanel} } from "../${folder}/components/configure-panel";`,
  ),
  '',
  "/** Each engine's Runtime Settings panel, by engine id. */",
  'export const engineConfigurePanels: Partial<',
  '  Record<string, ComponentType<EngineConfigurePanelProps>>',
  '> = {',
  ...enginePanelEntries.map(
    ({ folder, configurePanel }) => `  ${key(folder)}: ${configurePanel},`,
  ),
  '};',
  '',
]

writeFileSync(
  engineConfigurePanelsOutputPath,
  engineConfigurePanelLines.join('\n'),
  'utf8',
)

// Port allocation summary

/** Extract `port: <number>` from a data.ts file */
function extractPort(filePath) {
  const src = readFileSync(filePath, 'utf8')
  const m = src.match(/\bport:\s*(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

/** Extract `reservedPorts: [<numbers>]` from a data.ts file */
function extractReservedPorts(filePath) {
  const src = readFileSync(filePath, 'utf8')
  const m = src.match(/\breservedPorts:\s*\[([^\]]*?)\]/)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !isNaN(n))
}

const portEntries = []
const allPorts = new Set()

for (const { key: folderKey, dir: serviceDir } of services) {
  const dataPath = join(serviceDir, 'data.ts')
  const port = extractPort(dataPath)
  if (port !== null) {
    portEntries.push({ port, owner: folderKey })
    allPorts.add(port)
  }
  for (const rp of extractReservedPorts(dataPath)) {
    portEntries.push({ port: rp, owner: `${folderKey} (reserved)` })
    allPorts.add(rp)
  }
}

for (const { key: folderKey, dir: sampleDir } of sampleFolders) {
  const dataPath = join(sampleDir, 'data.ts')
  for (const rp of extractReservedPorts(dataPath)) {
    portEntries.push({ port: rp, owner: `sample:${folderKey} (reserved)` })
    allPorts.add(rp)
  }
}

portEntries.sort((a, b) => a.port - b.port)

const seen = new Map()
let duplicateWarning = ''
for (const { port, owner } of portEntries) {
  if (seen.has(port)) {
    duplicateWarning += `  ⚠️  Port ${port} used by both "${seen.get(port)}" and "${owner}"\n`
  }
  seen.set(port, owner)
}

let nextPort = 8001
while (allPorts.has(nextPort)) nextPort++

// Summary
print(
  `✓ Generated registries:\n` +
    `  services:  ${services.length} services, ${workerServices.length} workers, ${docsServices.length} docs → src/services/_generated/\n` +
    `  samples:   ${sampleFolders.length} samples → src/samples/_generated/\n` +
    `  engines:   ${engineFolders.length} engines → src/engines/_generated/`,
)

print('\n📡 Port allocation (ascending):')
for (const { port, owner } of portEntries) {
  print(`  ${port}  ${owner}`)
}
if (duplicateWarning) {
  print('\n⚠️  Duplicate port warnings:')
  process.stdout.write(duplicateWarning)
}
print(`\n✅ Next available port: ${nextPort}`)
