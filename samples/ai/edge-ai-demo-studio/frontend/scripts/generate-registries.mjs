#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-console */

/**
 * Auto-discovers service, samples, and engine folders and generates
 * _generated/ registries for each.
 * Run: npm run codegen
 *
 * When adding a new service:
 *   1. Create src/services/<folder>/data.ts  — must export `service` (ServiceMeta)
 *   2. Create src/services/<folder>/demo.tsx — must export a single React component
 *   3. For worker-based services: also export `worker` (WorkerConfig) from data.ts
 *   4. Run `npm run codegen`
 *
 * When adding a new sample:
 *   1. Create src/samples/<folder>/data.ts  — must export `sample` (Sample)
 *   2. Run `npm run codegen`
 *
 * When adding a new engine:
 *   1. Create src/engines/<folder>/data.ts            — must export `engine` (Engine)
 *   2. Create src/engines/<folder>/process-handler.ts — must export `start<PascalName>Model`
 *   3. Run `npm run codegen`
 *
 * The folder name is used directly as the key in the generated maps.
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

const _dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = join(_dirname, '..', 'src')

// ─── Common helpers ───────────────────────────────────────────────

const SKIP = new Set(['common', '_generated'])

const GROUP_FOLDERS = new Set(['suites'])
const HEADER = [
  '// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.',
  '// Source of truth: scripts/generate-registries.mjs',
  '// Run "npm run codegen" to regenerate.',
  '',
]

/** Quote a folder name as an object key when necessary */
function key(folder) {
  return /[^a-zA-Z0-9_$]/.test(folder) ? `"${folder}"` : folder
}

/** Convert a folder name to camelCase */
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

/** Check whether a string is a valid JS identifier (basic heuristic). */
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
    let j = idx + 6 // move past 'export'
    // skip whitespace
    while (j < src.length && isWhitespace(src[j])) j++
    // expect 'const'
    if (src.startsWith('const', j)) {
      j += 5 // move past 'const'
      while (j < src.length && isWhitespace(src[j])) j++
      // parse identifier
      if (j < src.length && isIdentStart(src[j])) {
        let k = j + 1
        while (k < src.length && isIdentPart(src[k])) k++
        const ident = src.slice(j, k)
        if (ident === name) return true
      }
    }
    idx = idx + 6 // continue search after this 'export'
  }
}

/** Ensure directory exists */
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

// ═══════════════════════════════════════════════════════════════════
// ─── Services ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

const servicesDir = join(srcDir, 'services')
const servicesGenDir = join(servicesDir, '_generated')
ensureDir(servicesGenDir)

const metaOutputPath = join(servicesGenDir, 'meta.ts')
const outputPath = join(servicesGenDir, 'services.ts')
const workerRegistryPath = join(servicesGenDir, 'workers.ts')
const docsRegistryPath = join(servicesGenDir, 'docs.ts')
const configurePanelRegistryPath = join(servicesGenDir, 'configure-panels.ts')

/** Convert a folder name to a camelCase alias (e.g. "text-generation" → "textGenerationMeta") */
function toAlias(folder) {
  return `${toCamel(folder)}Meta`
}

/** Resolve the demo file path — supports both demo.tsx and demo/index.tsx */
function resolveDemoPath(serviceDir) {
  const flat = join(serviceDir, 'demo.tsx')
  if (existsSync(flat)) return flat
  const nested = join(serviceDir, 'demo', 'index.tsx')
  if (existsSync(nested)) return nested
  return null
}

/**
 * Resolve an optional service-specific configure panel.
 * Supports:
 *  - <service>/configure-panel.tsx
 *  - <service>/components/configure-panel.tsx
 *  - <service>/demo/components/configure-panel.tsx
 */
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

// Scan for subdirectories that contain data.ts (supports nested suites/* layout)
const services = discoverLeafFolders(servicesDir).map(
  ({ key: folderKey, importPath, dir: serviceDir }) => {
    const dataPath = join(serviceDir, 'data.ts')
    const demoPath = resolveDemoPath(serviceDir)
    const configurePanel = resolveConfigurePanel(serviceDir, importPath)

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
      hasWorker: hasExport(dataPath, 'worker'),
      hasDocs: existsSync(join(serviceDir, 'docs.ts')),
    }
  },
)

// ─── Service code generation ──────────────────────────────────────

// --- _generated/meta.ts (no React/JSX deps) ---
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

// --- _generated/services.ts (includes React demo components) ---
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

// --- _generated/configure-panels.ts (optional service configure panels) ---
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
  'export function getServiceConfigurePanel(',
  '  serviceId: string,',
  '): ServiceConfigurePanelComponent | undefined {',
  '  return configurePanelRegistry[serviceId];',
  '}',
  '',
]

writeFileSync(
  configurePanelRegistryPath,
  configurePanelLines.join('\n'),
  'utf8',
)

// --- _generated/workers.ts (worker registry, no React deps) ---
const workerServices = services.filter((s) => s.hasWorker)

/** Convert folder to a camelCase worker alias (e.g. "speech-to-text" → "speechToTextWorker") */
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
  'export const workerRegistry: Partial<Record<Service["type"], WorkerConfig>> = {',
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

// --- _generated/docs.ts (docs factory registry) ---
const docsServices = services.filter((s) => s.hasDocs)

/** Convert a folder name to a camelCase docs alias (e.g. "speech-to-text" → "speechToTextDocs") */
function toDocsAlias(folder) {
  return `${toCamel(folder)}Docs`
}

const docsLines = [
  ...HEADER,
  'import type { ServiceDocsData } from "../types";',
  '',
  'export type DocsFactory = (opts: { host: string }) => ServiceDocsData;',
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

// ═══════════════════════════════════════════════════════════════════
// ─── Samples ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

const samplesDir = join(srcDir, 'samples')
const samplesGenDir = join(samplesDir, '_generated')
ensureDir(samplesGenDir)

const samplesOutputPath = join(samplesGenDir, 'samples.ts')

// Scan for subdirectories that contain data.ts (supports nested suites/* layout)
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

// ═══════════════════════════════════════════════════════════════════
// ─── Engines ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

const engineDir = join(srcDir, 'engines')
const engineGenDir = join(engineDir, '_generated')
ensureDir(engineGenDir)

const engineMetaOutputPath = join(engineGenDir, 'meta.ts')
const enginesOutputPath = join(engineGenDir, 'engines.ts')

// Scan for subdirectories that contain data.ts and process-handler.ts
const engineFolders = readdirSync(engineDir)
  .filter((name) => {
    if (SKIP.has(name)) return false
    const dir = join(engineDir, name)
    return (
      statSync(dir).isDirectory() &&
      existsSync(join(dir, 'data.ts')) &&
      existsSync(join(dir, 'process-handler.ts'))
    )
  })
  .sort()

/**
 * Parse the start handler export name from process-handler.ts.
 * Expects a pattern like: export const start<Name>Model = ...
 */
function parseStartHandler(filePath) {
  const src = readFileSync(filePath, 'utf8')
  const m = src.match(/export\s+const\s+(start\w+Model)\s*=/)
  if (!m) {
    throw new Error(`No start*Model export found in ${filePath}`)
  }
  return m[1]
}

const engineEntries = engineFolders.map((folder) => {
  const handlerPath = join(engineDir, folder, 'process-handler.ts')
  return {
    folder,
    alias: toCamel(folder),
    startHandler: parseStartHandler(handlerPath),
  }
})

// --- _generated/meta.ts (engines only, no handlers) ---
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

// --- _generated/engines.ts (imports meta + handlers) ---
const engineLines = [
  ...HEADER,
  'import type { BasePayload } from "payload";',
  'import type { Service } from "@/payload-types";',
  '',
  'import { engines as enginesMeta } from "./meta";',
  '',
  ...engineEntries.map(
    ({ folder, startHandler }) =>
      `import { ${startHandler} } from "../${folder}/process-handler";`,
  ),
  '',
  'export const engines = enginesMeta;',
  '',
  '/** Engine start handler signature. */',
  'export type EngineStartHandler = (',
  '  service: Service,',
  '  payload: BasePayload,',
  ') => Promise<void>;',
  '',
  '/** Maps engine identifiers to their start handlers. */',
  'export const engineHandlers: Record<string, EngineStartHandler> = {',
  ...engineEntries.map(
    ({ folder, startHandler }) => `  ${key(folder)}: ${startHandler},`,
  ),
  '};',
  '',
]

writeFileSync(enginesOutputPath, engineLines.join('\n'), 'utf8')

// ═══════════════════════════════════════════════════════════════════
// ─── Port allocation summary ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

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

// Find first duplicate
const seen = new Map()
let duplicateWarning = ''
for (const { port, owner } of portEntries) {
  if (seen.has(port)) {
    duplicateWarning += `  ⚠️  Port ${port} used by both "${seen.get(port)}" and "${owner}"\n`
  }
  seen.set(port, owner)
}

// Compute next available port
let nextPort = 8001
while (allPorts.has(nextPort)) nextPort++

// ─── Summary ──────────────────────────────────────────────────────
console.log(
  `✓ Generated registries:\n` +
    `  services:  ${services.length} services, ${workerServices.length} workers, ${docsServices.length} docs → src/services/_generated/\n` +
    `  samples:   ${sampleFolders.length} samples → src/samples/_generated/\n` +
    `  engines:   ${engineFolders.length} engines → src/engines/_generated/`,
)

console.log('\n📡 Port allocation (ascending):')
for (const { port, owner } of portEntries) {
  console.log(`  ${port}  ${owner}`)
}
if (duplicateWarning) {
  console.log('\n⚠️  Duplicate port warnings:')
  process.stdout.write(duplicateWarning)
}
console.log(`\n✅ Next available port: ${nextPort}`)
