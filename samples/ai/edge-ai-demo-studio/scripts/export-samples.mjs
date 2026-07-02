#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-console */

/**
 * Export a slim subset of Demo Studio that contains only the requested
 * samples plus the services and workers they depend on.
 *
 * Usage:
 *   node scripts/export-samples.mjs --samples=rag-chatbot,medical-scribe [--out=out/my-export] [--include-optional]
 *   node scripts/export-samples.mjs --list
 *
 * The output directory is self-contained: it has its own setup.sh /
 * setup_win.bat and start.sh / start_win.bat, with only the necessary
 * worker subdirectories and frontend service/sample folders.
 */

import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const FRONTEND_DIR = join(REPO_ROOT, 'frontend')
const SAMPLES_DIR = join(FRONTEND_DIR, 'src', 'samples')
const SERVICES_DIR = join(FRONTEND_DIR, 'src', 'services')
const WORKERS_DIR = join(REPO_ROOT, 'workers')

// ─── CLI parsing ──────────────────────────────────────────────────

function parseArgs(argv) {
  // Optional service deps are included by default — most samples gracefully
  // degrade without them but the demo experience is incomplete. Use
  // --no-optional to exclude them.
  const out = {
    samples: [],
    includeOptional: true,
    list: false,
    out: null,
    dryRun: false,
    json: false,
  }
  for (const arg of argv) {
    if (arg === '--list' || arg === '-l') {
      out.list = true
    } else if (arg === '--dry-run' || arg === '--plan') {
      out.dryRun = true
    } else if (arg === '--json') {
      out.json = true
    } else if (arg === '--include-optional') {
      out.includeOptional = true
    } else if (arg === '--no-optional' || arg === '--exclude-optional') {
      out.includeOptional = false
    } else if (arg.startsWith('--samples=')) {
      out.samples = arg
        .slice('--samples='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (arg.startsWith('--out=')) {
      out.out = arg.slice('--out='.length)
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      console.error(`Unknown argument: ${arg}`)
      printHelp()
      process.exit(1)
    }
  }
  return out
}

function printHelp() {
  console.log(`Usage: node scripts/export-samples.mjs --samples=<id1,id2,...> [options]

Options:
  --samples=<ids>      Comma-separated sample IDs to export (required)
  --no-optional        Exclude each sample's optional service deps
                       (optional deps are INCLUDED by default)
  --include-optional   Explicitly include optional deps (default behavior)
  --out=<path>         Output directory (default: out/<sample-ids>)
  --dry-run, --plan    Resolve the export plan and exit without writing files
  --json               Emit machine-readable JSON (with --list or --dry-run)
  --list, -l           List available samples and exit
  --help, -h           Show this help

Examples:
  node scripts/export-samples.mjs --samples=rag-chatbot
  node scripts/export-samples.mjs --samples=rag-chatbot --no-optional
  node scripts/export-samples.mjs --samples=medical-scribe,rag-chatbot
`)
}

// ─── Discovery / parsing ──────────────────────────────────────────
const GROUP_FOLDERS = new Set(['suites'])
const SKIP_FOLDERS = new Set(['common', '_generated'])

/** Map each entity id to its path (relative to baseDir), descending into groups. */
function discoverEntities(baseDir) {
  const map = new Map()
  for (const name of readdirSync(baseDir)) {
    if (SKIP_FOLDERS.has(name)) continue
    const dir = join(baseDir, name)
    if (!statSync(dir).isDirectory()) continue

    if (GROUP_FOLDERS.has(name)) {
      // Descend exactly one level: <base>/<group>/<suite>/<id>/data.ts
      for (const suite of readdirSync(dir)) {
        if (SKIP_FOLDERS.has(suite)) continue
        const suiteDir = join(dir, suite)
        if (!statSync(suiteDir).isDirectory()) continue
        for (const leaf of readdirSync(suiteDir)) {
          if (SKIP_FOLDERS.has(leaf)) continue
          const leafDir = join(suiteDir, leaf)
          if (!statSync(leafDir).isDirectory()) continue
          if (existsSync(join(leafDir, 'data.ts'))) {
            map.set(leaf, `${name}/${suite}/${leaf}`)
          }
        }
      }
      continue
    }

    if (existsSync(join(dir, 'data.ts'))) map.set(name, name)
  }
  return map
}

const sampleFolders = discoverEntities(SAMPLES_DIR)
const serviceFolders = discoverEntities(SERVICES_DIR)

function listSamples() {
  return [...sampleFolders.keys()].sort()
}

function listServiceFolders() {
  return [...serviceFolders.keys()].sort()
}

/**
 * Given a path relative to a base entity dir (e.g. `suites/foo/bar/data.ts`),
 * return the owning entity id, or null if it belongs to none (e.g. shared
 * `common/` files or top-level barrels).
 */
function ownerOf(relFromBase, folderMap) {
  for (const [id, folder] of folderMap) {
    if (relFromBase === folder || relFromBase.startsWith(`${folder}/`)) return id
  }
  return null
}

/**
 * Decide whether a tracked file under `frontend/src/<kind>/` should be kept.
 * Returns true/false for entity files, or null when `rel` isn't one (a
 * top-level barrel like registry.ts, or a path outside <kind>/) so the caller
 * can fall through. Handles both the flat `<id>/` and nested
 * `suites/<suite>/<id>/` layouts.
 */
function keepEntityFile(rel, kind, folderMap, keptIds) {
  const prefix = `frontend/src/${kind}/`
  if (!rel.startsWith(prefix)) return null
  const sub = rel.slice(prefix.length)
  if (!sub.includes('/')) return null // top-level barrel (registry.ts, types.ts)
  const seg0 = sub.split('/')[0]
  if (seg0 === '_generated') return true
  // Prune the shared `common` barrel to the files reachable from the kept
  // entities (see the import-graph walk in main).
  if (seg0 === 'common') return keptCommonFiles.has(rel)
  const id = ownerOf(sub, folderMap)
  return id !== null && keptIds.has(id)
}

/** Extract dependencies from a sample's data.ts via a permissive regex. */
function parseSampleDeps(id) {
  const dataPath = join(SAMPLES_DIR, sampleFolders.get(id), 'data.ts')
  const src = readFileSync(dataPath, 'utf8')
  const deps = []
  const re =
    /\{\s*serviceId\s*:\s*['"]([\w-]+)['"][^{}]*?role\s*:\s*['"](required|optional)['"][^{}]*?\}/gs
  let m
  while ((m = re.exec(src)) !== null) {
    deps.push({ serviceId: m[1], role: m[2] })
  }
  return deps
}

/** Parse a service's data.ts for execution mode + workerSubDir. */
function parseServiceInfo(id) {
  const dataPath = join(SERVICES_DIR, serviceFolders.get(id), 'data.ts')
  const src = readFileSync(dataPath, 'utf8')
  const modeMatch = src.match(/execution\s*:\s*\{[^}]*mode\s*:\s*['"](\w+)['"]/)
  const mode = modeMatch ? modeMatch[1] : 'worker'
  const subDirLiteral = src.match(/workerSubDir\s*:\s*['"]([^'"]+)['"]/)
  return {
    folder: id,
    mode,
    workerSubDir: subDirLiteral ? subDirLiteral[1] : null,
  }
}

// ─── Module-graph reachability ────────────────────────────────────
//
// To decide which services a set of samples really needs, we walk the
// TypeScript import graph starting from the kept sample folders (plus the
// shared frontend infra that is always copied). A service is included only if
// some reachable file lives in — or is imported by — its folder. This is far
// more precise than scanning the shared `common/` barrels wholesale, which
// dragged in every service referenced by *any* sample's helper (e.g. pulling
// wake-word-detection into a RAG-only export).

const FRONTEND_SRC = join(FRONTEND_DIR, 'src')
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

function isGeneratedPath(p) {
  return /[\\/]_generated[\\/]/.test(p)
}

function toPosixRel(fromAbs, fileAbs) {
  return relative(fromAbs, fileAbs).split(sep).join('/')
}

/** Resolve an import specifier from `importerAbs` to an absolute source file, or null. */
function resolveImport(spec, importerAbs) {
  let base
  if (spec.startsWith('@/')) {
    base = join(FRONTEND_SRC, spec.slice(2))
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    base = resolve(dirname(importerAbs), spec)
  } else {
    return null // bare module specifier (node_modules) or alias we don't follow
  }
  const candidates = [base]
  for (const ext of RESOLVE_EXTS) candidates.push(base + ext)
  for (const ext of RESOLVE_EXTS) candidates.push(join(base, `index${ext}`))
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

/** Extract import/export/require/dynamic-import specifiers from source text. */
function extractSpecifiers(src) {
  const specs = new Set()
  // `\bfrom '...'` (not anchored to the import keyword) so multi-line named
  // imports — `import {\n  a,\n  b,\n} from '...'` — are matched too.
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g, // import/export ... from '...'
    /\bimport\s*['"]([^'"]+)['"]/g, // side-effect import '...'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import('...')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(src)) !== null) specs.add(m[1])
  }
  return specs
}

/** BFS the import graph from `entryFiles`, skipping codegen `_generated` dirs. */
function reachableFiles(entryFiles) {
  const visited = new Set()
  const stack = entryFiles.filter((f) => existsSync(f))
  while (stack.length > 0) {
    const file = stack.pop()
    if (visited.has(file)) continue
    visited.add(file)
    let src
    try {
      src = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const spec of extractSpecifiers(src)) {
      const target = resolveImport(spec, file)
      if (target && !visited.has(target) && !isGeneratedPath(target)) {
        stack.push(target)
      }
    }
  }
  return visited
}

/** All source files under `absDir` (recursive), skipping `_generated` dirs. */
function sourceFilesUnder(absDir) {
  const out = []
  if (!existsSync(absDir)) return out
  const stack = [absDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir)) {
      if (entry === '_generated') continue
      const p = join(dir, entry)
      const s = statSync(p)
      if (s.isDirectory()) stack.push(p)
      else if (RESOLVE_EXTS.some((e) => entry.endsWith(e))) out.push(p)
    }
  }
  return out
}

// ─── Copy helpers ─────────────────────────────────────────────────

/**
 * List git-tracked files under a path (relative to REPO_ROOT). Using
 * git ls-files automatically respects each subproject's .gitignore so
 * that build artefacts, virtualenvs, downloaded models, etc. are
 * excluded.
 */
function gitTrackedFiles(relPath) {
  const out = execFileSync('git', ['ls-files', '-z', '--', relPath], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  })
  return out
    .toString('utf8')
    .split('\u0000')
    .filter(Boolean)
}

function copyFile(src, dest) {
  if (!existsSync(src)) return false
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest)
  return true
}

/** Copy a list of repo-relative file paths into the output, preserving structure. */
function copyTrackedFiles(relFiles, outRoot, rewrite = (p) => p) {
  for (const rel of relFiles) {
    const srcAbs = join(REPO_ROOT, rel)
    if (!existsSync(srcAbs)) continue
    const destRel = rewrite(rel)
    if (destRel === null) continue
    copyFile(srcAbs, join(outRoot, destRel))
  }
}

// ─── Main ─────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2))

if (args.list) {
  if (args.json) {
    console.log(JSON.stringify({ samples: listSamples() }, null, 2))
  } else {
    console.log('Available samples:')
    for (const s of listSamples()) console.log(`  - ${s}`)
  }
  process.exit(0)
}

if (args.samples.length === 0) {
  console.error('Error: --samples=<ids> is required (or use --list)')
  printHelp()
  process.exit(1)
}

const allSamples = listSamples()
const allServices = listServiceFolders()

const unknown = args.samples.filter((s) => !allSamples.includes(s))
if (unknown.length > 0) {
  console.error(`Unknown sample(s): ${unknown.join(', ')}`)
  console.error('Run with --list to see available samples.')
  process.exit(1)
}

// Resolve services
const requiredServiceIds = new Set()
const optionalServiceIds = new Set()
const sampleSummaries = []
for (const sampleId of args.samples) {
  const deps = parseSampleDeps(sampleId)
  for (const d of deps) {
    if (d.role === 'required') requiredServiceIds.add(d.serviceId)
    else optionalServiceIds.add(d.serviceId)
  }
  sampleSummaries.push({ id: sampleId, deps })
}

for (const id of requiredServiceIds) optionalServiceIds.delete(id)

const includedServiceIds = new Set(requiredServiceIds)
if (args.includeOptional) {
  for (const id of optionalServiceIds) includedServiceIds.add(id)
}

// The shared `common` barrels (`src/samples/common`, `src/services/common`)
// hold helpers for *many* samples. Copying them wholesale and scanning them for
// `@/services/<id>` would over-include services that a kept sample doesn't use.
//
// Instead we walk the actual import graph from the kept samples (plus the
// shared frontend infra that is always copied) and include a service only if
// it is genuinely reachable. The same walk tells us exactly which `common`
// files are needed, so the rest can be pruned. Because whole service folders
// are copied, we iterate to a fixpoint: each newly-included service is seeded
// back in so its own imports (e.g. lipsync → text-to-speech) are followed too.
//
// Optional-service integrations live in their own service folder and are wired
// through the generated feature-provider registry (skipped by this walk), so an
// unused optional service is never reachable and `--no-optional` can drop it.
// See docs/OPTIONAL-SERVICES.md.

// Shared-infra roots: everything under src/ that isn't a specific sample or
// service folder (those are handled separately) and isn't a per-sample API
// route that will be pruned away. The shared infra resolves samples/services
// dynamically via the regenerated `_generated` registries, so seeding it here
// does not pull in unrelated entities.
const sharedInfraRoots = []
for (const file of sourceFilesUnder(FRONTEND_SRC)) {
  const segs = toPosixRel(FRONTEND_SRC, file).split('/')
  if (segs[0] === 'samples' || segs[0] === 'services') continue
  if (segs[0] === 'app' && segs[1] === 'api' && segs[2]) {
    const apiFolder = segs[2]
    if (allSamples.includes(apiFolder) && !args.samples.includes(apiFolder)) {
      continue
    }
  }
  sharedInfraRoots.push(file)
}

const sampleRoots = args.samples.flatMap((id) =>
  sourceFilesUnder(join(SAMPLES_DIR, sampleFolders.get(id))),
)

let reached
for (;;) {
  const roots = [...sampleRoots, ...sharedInfraRoots]
  for (const id of includedServiceIds) {
    roots.push(...sourceFilesUnder(join(SERVICES_DIR, serviceFolders.get(id))))
  }
  reached = reachableFiles(roots)

  const before = includedServiceIds.size
  for (const file of reached) {
    const relSrc = toPosixRel(FRONTEND_SRC, file)
    if (!relSrc.startsWith('services/')) continue
    // ownerOf resolves nested suite paths and only returns known ids, so
    // shared `common/` files and barrels yield null and are ignored.
    const id = ownerOf(relSrc.slice('services/'.length), serviceFolders)
    if (id) includedServiceIds.add(id)
  }
  if (includedServiceIds.size === before) break
}

// Reached files under the shared `common` barrels — only these get copied.
const keptCommonFiles = new Set()
for (const file of reached) {
  const rel = toPosixRel(REPO_ROOT, file)
  if (
    rel.startsWith('frontend/src/samples/common/') ||
    rel.startsWith('frontend/src/services/common/')
  ) {
    keptCommonFiles.add(rel)
  }
}

// Validate that every included service exists as a folder
const missingService = [...includedServiceIds].filter(
  (id) => !allServices.includes(id),
)
if (missingService.length > 0) {
  console.error(`Service folders missing for: ${missingService.join(', ')}`)
  process.exit(1)
}

// Resolve worker dirs. Most workers are a single top-level dir under workers/;
// suite workers are nested (workers/suite/<suite>/<leaf>) and tracked precisely
// so unrelated suites/apps aren't dragged in.
const workerDirs = new Set(['helper'])
const suiteWorkerDirs = new Set()
let needsMultiserve = false
for (const id of includedServiceIds) {
  const info = parseServiceInfo(id)
  if (info.mode === 'worker') {
    const sub = info.workerSubDir ?? id
    const segs = sub.split('/')
    if (segs[0] === 'suite') {
      // workerSubDir is `suite/<suite>/<leaf>`; keep just that leaf app dir.
      suiteWorkerDirs.add(segs.slice(0, 3).join('/'))
    } else {
      // Some services use a function returning '<name>/<model>'; take the parent.
      workerDirs.add(segs[0])
    }
  } else if (info.mode === 'multiserve') {
    needsMultiserve = true
  }
  // 'none' => no worker
}
if (needsMultiserve) workerDirs.add('engine/multiserve')

// Combined list for human-readable / manifest reporting.
const reportedWorkerDirs = [...workerDirs, ...suiteWorkerDirs].sort()

// The resolved plan — shared by the JSON dry-run (used by the UI export
// preview) and the EXPORT_MANIFEST written at the end, so the preview always
// matches what an actual export would produce.
const exportPlan = {
  samples: sampleSummaries,
  services: {
    required: [...requiredServiceIds].sort(),
    optional: [...optionalServiceIds].sort(),
    included: [...includedServiceIds].sort(),
  },
  workers: reportedWorkerDirs,
  includeOptional: args.includeOptional,
}

// Dry run: resolve the plan and stop before touching the filesystem.
if (args.dryRun) {
  if (args.json) {
    console.log(JSON.stringify(exportPlan, null, 2))
  } else {
    console.log(`Export plan (dry run)`)
    console.log(`  Samples:  ${args.samples.join(', ')}`)
    console.log(`  Services: ${exportPlan.services.included.join(', ') || '(none)'}`)
    console.log(`  Workers:  ${exportPlan.workers.join(', ')}`)
  }
  process.exit(0)
}

// Output directory — resolved relative to the user's cwd so that paths like
// `--out=out/foo` work whether the script is invoked from the repo root or
// from frontend/ via `npm run export-samples`.
const outDirRel = args.out ?? `out/${args.samples.join('_')}`
const outDir = args.out
  ? resolve(process.cwd(), outDirRel)
  : resolve(REPO_ROOT, outDirRel)

console.log(`\nExport plan`)
console.log(`  Samples:  ${args.samples.join(', ')}`)
console.log(
  `  Services: ${[...includedServiceIds].sort().join(', ') || '(none)'}`,
)
console.log(`  Workers:  ${reportedWorkerDirs.join(', ')}`)
console.log(`  Output:   ${relative(REPO_ROOT, outDir)}\n`)

// Wipe & recreate output
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// 1) Frontend — copy tracked files, then prune samples/services we don't want.
const keptSampleIds = new Set(args.samples)
const frontendFiles = gitTrackedFiles('frontend').filter((rel) => {
  // Skip Playwright tests + config; they pull dev-only deps and aren't needed.
  if (rel === 'frontend/playwright.config.ts') return false
  if (rel.startsWith('frontend/tests/')) return false

  // Sample folders (flat `<id>/` or nested `suites/<suite>/<id>/`)
  const sampleDecision = keepEntityFile(
    rel,
    'samples',
    sampleFolders,
    keptSampleIds,
  )
  if (sampleDecision !== null) return sampleDecision

  // Service folders (flat or nested, as above)
  const serviceDecision = keepEntityFile(
    rel,
    'services',
    serviceFolders,
    includedServiceIds,
  )
  if (serviceDecision !== null) return serviceDecision

  // Sample- or service-specific Next.js API routes
  const apiM = rel.match(/^frontend\/src\/app\/api\/([^/]+)\//)
  if (apiM) {
    const folder = apiM[1]
    if (allSamples.includes(folder)) return args.samples.includes(folder)
    if (allServices.includes(folder)) return includedServiceIds.has(folder)
    // Special-case: wake-word-events route is only useful with that service
    if (folder === 'wake-word-events') {
      return includedServiceIds.has('wake-word-detection')
    }
    return true
  }

  return true
})
copyTrackedFiles(frontendFiles, outDir)

// 2) Workers — copy only the worker dirs we need (plus the top-level setup
//    scripts), via git ls-files to skip .venv/, .cache/, models/, etc.
const workerSetupFiles = ['workers/setup.sh', 'workers/setup.ps1']
copyTrackedFiles(workerSetupFiles, outDir)

for (const wd of workerDirs) {
  const files = gitTrackedFiles(`workers/${wd}`)
  copyTrackedFiles(files, outDir)
}

// Suite workers are nested (workers/suite/<suite>/<leaf>). Each suite has its
// own setup.sh/setup.ps1 that the suite's start script invokes on first launch
// (guarded by a sentinel file). The top-level workers/suite orchestrator setup
// has been removed; only the per-suite scripts are needed.
for (const swd of suiteWorkerDirs) {
  copyTrackedFiles(gitTrackedFiles(`workers/${swd}`), outDir)
  const suiteName = swd.split('/')[1]
  copyTrackedFiles(
    [
      `workers/suite/${suiteName}/setup.sh`,
      `workers/suite/${suiteName}/setup.ps1`,
    ],
    outDir,
  )
}

// The multiserve worker lives at workers/engine/multiserve, but workers/setup.sh
// only discovers *direct* children of workers/ that contain a setup script. The
// `engine` dir has its own orchestrator setup that runs its children — copy it
// so the exported setup actually reaches multiserve (otherwise it's silently
// skipped and the engine never gets installed).
if (needsMultiserve) {
  copyTrackedFiles(
    ['workers/engine/setup.sh', 'workers/engine/setup.ps1'],
    outDir,
  )
}

// 3) Root files
for (const f of [
  'setup.sh',
  'setup_win.bat',
  'start.sh',
  'start_win.bat',
  'install_dependencies.sh',
  'README.md',
]) {
  copyFile(join(REPO_ROOT, f), join(outDir, f))
}

// 4) scripts/ — keep only the bits referenced by setup.sh / setup_win.bat
copyTrackedFiles(
  [
    'scripts/bash/setup_thirdparty.sh',
    'scripts/win/install_visual_cpp_redistributable.ps1',
    'scripts/win/setup_thirdparty.ps1',
    'scripts/win/setup.ps1',
    'scripts/win/start.ps1',
  ],
  outDir,
)

// 5) Patch the generated registry codegen to widen types so the pruned
//    maps still typecheck against the unchanged payload-types.ts service
//    type union (and against code that does `metaMap['some-other-id']`).
{
  const codegenPath = join(
    outDir,
    'frontend',
    'scripts',
    'generate-registries.mjs',
  )
  let src = readFileSync(codegenPath, 'utf8')
  src = src.replaceAll(
    'Record<ServiceType["type"], Service>',
    'Record<string, Service>',
  )
  // Add an explicit type annotation to metaMap so unknown keys resolve to
  // `ServiceMeta | undefined` instead of being a TS error.
  src = src.replace(
    `'export const metaMap = {',`,
    `'import type { ServiceMeta } from "../types";',\n  '',\n  'export const metaMap: Record<string, ServiceMeta> = {',`,
  )
  writeFileSync(codegenPath, src, 'utf8')
}

// 6) Run codegen in the exported tree to regenerate _generated/ folders
console.log('Running codegen in exported tree...')
execFileSync(
  process.execPath,
  [join(outDir, 'frontend', 'scripts', 'generate-registries.mjs')],
  { stdio: 'inherit' },
)

// 7) Write a manifest summarising what was exported
writeFileSync(
  join(outDir, 'EXPORT_MANIFEST.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), ...exportPlan }, null, 2),
)

console.log(`\n✓ Export complete: ${relative(REPO_ROOT, outDir)}`)
console.log(
  `  Next: cd ${relative(REPO_ROOT, outDir)} && bash setup.sh && bash start.sh`,
)
