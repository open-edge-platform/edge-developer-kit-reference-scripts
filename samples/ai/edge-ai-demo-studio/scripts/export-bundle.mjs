#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-console */

/**
 * Export a self-contained subset of Demo Studio: the requested samples and/or services plus the
 * services and workers they depend on, with its own setup and start scripts. See --help.
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
  // Optional deps are included by default: samples run without them, but the demo is incomplete.
  const out = {
    samples: [],
    services: [],
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
    } else if (arg.startsWith('--services=')) {
      out.services = arg
        .slice('--services='.length)
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
  console.log(`Usage: node scripts/export-bundle.mjs --samples=<id1,id2,...> [options]

Options:
  --samples=<ids>      Comma-separated sample IDs to export
  --services=<ids>     Comma-separated service IDs to export directly (can be
                       used alone for a services-only export with no samples)
  --no-optional        Exclude each sample's optional service deps
                       (optional deps are INCLUDED by default)
  --include-optional   Explicitly include optional deps (default behavior)
  --out=<path>         Output directory (default: out/<ids>)
  --dry-run, --plan    Resolve the export plan and exit without writing files
  --json               Emit machine-readable JSON (with --list or --dry-run)
  --list, -l           List available samples and services, then exit
  --help, -h           Show this help

At least one of --samples / --services is required.

Examples:
  node scripts/export-bundle.mjs --samples=rag-chatbot
  node scripts/export-bundle.mjs --samples=rag-chatbot --no-optional
  node scripts/export-bundle.mjs --samples=medical-scribe,rag-chatbot
  node scripts/export-bundle.mjs --services=text-to-speech,ocr
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

/** Entity id owning a path relative to the base dir (e.g. `suites/foo/bar/data.ts`), or null. */
function ownerOf(relFromBase, folderMap) {
  for (const [id, folder] of folderMap) {
    if (relFromBase === folder || relFromBase.startsWith(`${folder}/`)) return id
  }
  return null
}

/** Whether to keep a file under `frontend/src/<kind>/`; null when it isn't an entity file. */
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
  // Shared files at a group's top level (suites/ports.ts) serve every entity in it.
  if (GROUP_FOLDERS.has(seg0) && sub.split('/').length === 2) return true
  const id = ownerOf(sub, folderMap)
  return id !== null && keptIds.has(id)
}

/** Extract dependencies from a sample's data.ts via a permissive regex. */
function parseSampleDeps(id) {
  const dataPath = join(SAMPLES_DIR, sampleFolders.get(id), 'data.ts')
  const src = readFileSync(dataPath, 'utf8')
  const deps = []
  // Only serviceId and role are read, so the match stops at role: a nested
  // object after it (e.g. `recommended: { device }`) must not hide the dep.
  const re =
    /\{\s*serviceId\s*:\s*['"]([\w-]+)['"][^{}]*?role\s*:\s*['"](required|optional)['"]/gs
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

/** `workers/`-relative dirs of a worker's `[tool.uv.sources]` path deps (other sources skipped). */
function uvPathSourceDirs(workerSubDir) {
  const pyprojectPath = join(WORKERS_DIR, workerSubDir, 'pyproject.toml')
  if (!existsSync(pyprojectPath)) return []
  const src = readFileSync(pyprojectPath, 'utf8')
  const tableMatch = src.match(/\[tool\.uv\.sources\]([\s\S]*?)(?:\n\[|$)/)
  if (!tableMatch) return []
  const table = tableMatch[1]
  const dirs = []
  const pathRe = /path\s*=\s*['"]([^'"]+)['"]/g
  let m
  while ((m = pathRe.exec(table)) !== null) {
    const abs = resolve(join(WORKERS_DIR, workerSubDir), m[1])
    const rel = relative(WORKERS_DIR, abs).split(sep).join('/')
    // Only deps that are a direct child of workers/ are followed.
    if (rel && !rel.startsWith('..') && !rel.includes('/')) dirs.push(rel)
  }
  return dirs
}

// ─── Module-graph reachability ────────────────────────────────────

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

/** Git-tracked files under a repo-relative path, so ignored venvs, models and builds are skipped. */
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
    console.log(
      JSON.stringify(
        { samples: listSamples(), services: listServiceFolders() },
        null,
        2,
      ),
    )
  } else {
    console.log('Available samples:')
    for (const s of listSamples()) console.log(`  - ${s}`)
    console.log('Available services:')
    for (const s of listServiceFolders()) console.log(`  - ${s}`)
  }
  process.exit(0)
}

if (args.samples.length === 0 && args.services.length === 0) {
  console.error(
    'Error: --samples=<ids> or --services=<ids> is required (or use --list)',
  )
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

const unknownServices = args.services.filter((s) => !allServices.includes(s))
if (unknownServices.length > 0) {
  console.error(`Unknown service(s): ${unknownServices.join(', ')}`)
  console.error('Run with --list to see available services.')
  process.exit(1)
}

// Requested services count as required, so a services-only export resolves like a sample one.
const requiredServiceIds = new Set(args.services)
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

// Include a service only if the import graph from the kept samples and shared infra reaches it:
// the shared `common` barrels serve many samples, so scanning them would over-include. Iterate to a
// fixpoint so each new service's own imports count. Optional services are wired through the
// generated feature-provider registry, which the walk skips, so --no-optional can drop them.

// Shared infra: all of src/ except sample/service folders and other samples' API routes. It reaches
// entities only through the `_generated` registries, which the walk skips.
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

const missingService = [...includedServiceIds].filter(
  (id) => !allServices.includes(id),
)
if (missingService.length > 0) {
  console.error(`Service folders missing for: ${missingService.join(', ')}`)
  process.exit(1)
}

// workerSubDir values carry their group prefix (`services/<name>`, `suites/<suite>/<leaf>`).
// `services/helper` backs the device-detection API routes; every service depends on `common`.
const workerDirs = new Set(['common', 'services/helper'])
const suiteWorkerDirs = new Set()
let needsMultiserve = false
for (const id of includedServiceIds) {
  const info = parseServiceInfo(id)
  if (info.mode === 'worker') {
    // Without a literal workerSubDir (none set, or a function picking the
    // backend) the worker lives at workers/services/<id>, as in
    // resolveWorkerDir (frontend/src/lib/workers/worker-dir.ts).
    const sub = info.workerSubDir ?? `services/${id}`
    const segs = sub.split('/')
    if (segs[0] === 'suites') {
      // workerSubDir is `suites/<suite>/<leaf>`; keep just that leaf app dir.
      suiteWorkerDirs.add(segs.slice(0, 3).join('/'))
    } else {
      // `services/<name>[/<backend>]`: keep the group dir, so multi-backend workers ship whole.
      workerDirs.add(segs.slice(0, 2).join('/'))
    }
  } else if (info.mode === 'multiserve') {
    needsMultiserve = true
  }
  // 'none' => no worker
}
if (needsMultiserve) workerDirs.add('engines/multiserve')

// Follow local uv path deps (`foo = { path = "../foo" }`) to a fixpoint. Workspace members use
// `{ workspace = true }` instead, and excluded projects' path deps point into common/.
for (;;) {
  const before = workerDirs.size
  for (const wd of [...workerDirs]) {
    for (const dep of uvPathSourceDirs(wd)) workerDirs.add(dep)
  }
  if (workerDirs.size === before) break
}

// Combined list for human-readable / manifest reporting.
const reportedWorkerDirs = [...workerDirs, ...suiteWorkerDirs].sort()

// Shared by the JSON dry-run (the UI's export preview) and EXPORT_MANIFEST, so the two always match.
const exportPlan = {
  samples: sampleSummaries,
  requestedServices: [...args.services].sort(),
  services: {
    required: [...requiredServiceIds].sort(),
    optional: [...optionalServiceIds].sort(),
    included: [...includedServiceIds].sort(),
  },
  workers: reportedWorkerDirs,
  includeOptional: args.includeOptional,
}

/** Human-readable plan; mentions only what was requested. */
function printPlan(header) {
  console.log(header)
  if (args.samples.length > 0) {
    console.log('  Samples:')
    for (const s of sampleSummaries) {
      const svcs = s.deps
        .filter((d) => includedServiceIds.has(d.serviceId))
        .map((d) =>
          d.role === 'optional' ? `${d.serviceId} (optional)` : d.serviceId,
        )
      console.log(`    - ${s.id} (services: ${svcs.join(', ') || 'none'})`)
    }
  }
  if (args.services.length > 0) {
    const label =
      args.samples.length > 0 ? 'Services (requested directly)' : 'Services'
    console.log(`  ${label}: ${[...args.services].sort().join(', ')}`)
  }
  // Services pulled in transitively (via imports of the ones above) that
  // haven't been mentioned yet.
  const mentioned = new Set(args.services)
  for (const s of sampleSummaries) {
    for (const d of s.deps) mentioned.add(d.serviceId)
  }
  const extra = [...includedServiceIds]
    .filter((id) => !mentioned.has(id))
    .sort()
  if (extra.length > 0) {
    console.log(`  Services (transitive deps): ${extra.join(', ')}`)
  }
  console.log(`  Workers:  ${reportedWorkerDirs.join(', ')}`)
}

// Dry run: resolve the plan and stop before touching the filesystem.
if (args.dryRun) {
  if (args.json) {
    console.log(JSON.stringify(exportPlan, null, 2))
  } else {
    printPlan('Export plan (dry run)')
  }
  process.exit(0)
}

// --out is relative to the cwd, so it works from the repo root and from frontend/ (npm script).
const outDirRel = args.out ?? `out/${[...args.samples, ...args.services].join('_')}`
const outDir = args.out
  ? resolve(process.cwd(), outDirRel)
  : resolve(REPO_ROOT, outDirRel)

console.log('')
printPlan('Export plan')
console.log(`  Output:   ${relative(REPO_ROOT, outDir)}\n`)

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
    return true
  }

  return true
})
copyTrackedFiles(frontendFiles, outDir)

// 2) Workers: the needed worker dirs plus the workspace root, lock and shared helpers (without
//    them the bundle has no workspace), and the upstream-code catalogue and fetch script setup uses.
const workerSetupFiles = [
  'workers/setup.sh',
  'workers/setup.ps1',
  'workers/pyproject.toml',
  'workers/uv.lock',
  'workers/.python-version',
  'workers/scripts/worker-common.sh',
  'workers/scripts/worker-common.ps1',
  'workers/scripts/oep_env.py',
  'workers/oep-setup.sh',
  'workers/oep-setup.ps1',
  'workers/oep-services.json',
  'workers/oep-services.schema.json',
]
copyTrackedFiles(workerSetupFiles, outDir)

for (const wd of workerDirs) {
  const files = gitTrackedFiles(`workers/${wd}`)
  copyTrackedFiles(files, outDir)
}

// Suite workers also need their suite's setup.sh/setup.ps1, which the start script runs on first launch.
for (const swd of suiteWorkerDirs) {
  copyTrackedFiles(gitTrackedFiles(`workers/${swd}`), outDir)
  const suiteName = swd.split('/')[1]
  copyTrackedFiles(
    [
      `workers/suites/${suiteName}/setup.sh`,
      `workers/suites/${suiteName}/setup.ps1`,
    ],
    outDir,
  )
}

// The engine binaries are shared third-party assets installed during setup.
if (needsMultiserve) {
  copyTrackedFiles(
    ['workers/engines/setup.sh', 'workers/engines/setup.ps1'],
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
    'scripts/bash/llamacpp_backend.sh',
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
