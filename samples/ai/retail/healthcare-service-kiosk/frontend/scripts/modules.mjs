#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The kiosk's parts, from the command line — healthcare-service-kiosk/docs/modules.md.
 *
 *   npm run modules                       every module, and whether config.yaml runs it
 *   npm run modules -- describe <id>      its files, packages and links
 *   npm run modules -- remove <id>...     delete it from the code, with whatever needs it
 *   npm run modules -- keep <id>...       delete every module but these and what they need
 *   npm run modules -- check [--deep]     the manifest matches the tree; --deep removes each
 *                                         module alone in a scratch copy and type-checks it
 *
 * remove/keep ask before deleting (--yes skips that, --dry-run only prints the
 * plan) and type-check afterwards (--no-check skips that).
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseDocument } from "yaml";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_FILES = ["config.yaml", "config.local.yaml", "configs"];
const COPY_SKIP = new Set([
  "node_modules",
  ".next",
  "test-results",
  "playwright-report",
  "tsconfig.tsbuildinfo",
  "face-photos",
  "config.yaml",
  "config.yaml.bak",
  "config.local.yaml",
  ".payload-secret",
]);

const rel = (root, file) => path.relative(root, file).split(path.sep).join("/");

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else yield file;
  }
}

async function serviceInfo(file) {
  try {
    const { service } = await import(pathToFileURL(file).href);
    return { id: service.id, label: service.label };
  } catch {
    // A service.ts with runtime imports Node cannot resolve: read the fields instead.
    const text = readFileSync(file, "utf8");
    const body = text.slice(text.indexOf("export const service"));
    return {
      id: /\bid:\s*["']([^"']+)/.exec(body)?.[1],
      label: /\blabel:\s*["']([^"']+)/.exec(body)?.[1] ?? "",
    };
  }
}

let loads = 0;

/** Every module of the tree at `root`: the manifest's, and one per service folder. */
async function loadModules(root) {
  // A fresh URL each time: Node caches modules by URL, and a removal rewrites the manifest.
  const manifest = `${pathToFileURL(path.join(root, "src/modules/manifest.ts")).href}?load=${++loads}`;
  const { MODULES } = await import(manifest);
  const listed = new Map(MODULES.map((m) => [m.id, m]));
  const modules = MODULES.filter((m) => m.kind !== "service").map((m) => ({ ...m }));
  const packs = path.join(root, "src/packs");
  for (const pack of readdirSync(packs, { withFileTypes: true })) {
    const base = path.join(packs, pack.name, "services");
    if (!pack.isDirectory() || !existsSync(base)) continue;
    for (const file of walk(base)) {
      if (path.basename(file) !== "service.ts") continue;
      const { id, label } = await serviceInfo(file);
      const extra = listed.get(id) ?? {};
      modules.push({
        ...extra,
        id,
        kind: "service",
        title: label,
        summary: "",
        dir: rel(root, path.dirname(file)),
        paths: [rel(root, path.dirname(file)), ...(extra.paths ?? [])],
      });
    }
  }
  const orphans = MODULES.filter((m) => m.kind === "service" && !modules.some((s) => s.id === m.id));
  return { modules, orphans };
}

function graph(modules) {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const dependents = (id) => modules.filter((m) => m.requires?.includes(id)).map((m) => m.id);
  return { byId, dependents };
}

/** The same switch logic the kiosk runs (src/modules/graph.ts). */
const graphOf = (root) => import(pathToFileURL(path.join(root, "src/modules/graph.ts")).href);

function unknownIds(modules, ids) {
  const known = new Set(modules.map((m) => m.id));
  return ids.filter((id) => !known.has(id));
}

/** `ids`, everything that needs them, and the shared parts nothing left needs. */
function removalOf(modules, ids) {
  const { dependents } = graph(modules);
  const removed = new Set();
  const visit = (id) => {
    if (removed.has(id)) return;
    removed.add(id);
    for (const dependent of dependents(id)) visit(dependent);
  };
  for (const id of ids) visit(id);
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of modules) {
      if (m.kind === "shared" && !removed.has(m.id) && dependents(m.id).every((d) => removed.has(d))) {
        removed.add(m.id);
        changed = true;
      }
    }
  }
  return removed;
}

/** Every module but `ids` and what they need. */
function keepingOnly(modules, ids) {
  const { byId } = graph(modules);
  const kept = new Set();
  const visit = (id) => {
    if (kept.has(id)) return;
    kept.add(id);
    for (const need of byId.get(id)?.requires ?? []) visit(need);
  };
  for (const id of ids) visit(id);
  return new Set(modules.filter((m) => !kept.has(m.id)).map((m) => m.id));
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** What deleting `removed` touches: files, package.json scripts, and packages nothing kept imports. */
function planFor(root, modules, removed) {
  const kept = modules.filter((m) => !removed.has(m.id));
  const keptPaths = kept.flatMap((m) => m.paths ?? []);
  const owned = (p) => keptPaths.some((k) => k === p || p.startsWith(`${k}/`) || k.startsWith(`${p}/`));
  const gone = modules.filter((m) => removed.has(m.id));
  const paths = [...new Set(gone.flatMap((m) => m.paths ?? []))].filter((p) => !owned(p));
  const keptPackages = new Set(kept.flatMap((m) => m.packages ?? []));
  const pkg = readJson(path.join(root, "package.json"));
  const installed = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  const packages = [...new Set(gone.flatMap((m) => m.packages ?? []))].filter(
    (p) => !keptPackages.has(p) && p in installed,
  );
  const scripts = [...new Set(gone.flatMap((m) => m.scripts ?? []))].filter((s) => pkg.scripts?.[s]);
  return { removed: gone, paths, packages, scripts };
}

function printPlan(root, plan) {
  console.log("\nModules to remove:");
  for (const m of plan.removed) console.log(`  ${m.id.padEnd(14)} ${m.kind.padEnd(8)} ${m.title}`);
  console.log("\nFiles and folders to delete:");
  for (const p of plan.paths) console.log(`  ${p}${existsSync(path.join(root, p)) ? "" : "   (already gone)"}`);
  if (plan.scripts.length) console.log(`\npackage.json scripts to drop: ${plan.scripts.join(", ")}`);
  if (plan.packages.length) console.log(`\nPackages nothing else imports: ${plan.packages.join(" ")}`);
}

/** Group and category folders left with no service in them. */
function pruneEmptyBranches(root, serviceDirs) {
  const services = (dir) => existsSync(dir) && [...walk(dir)].some((f) => path.basename(f) === "service.ts");
  for (const dir of serviceDirs) {
    for (let up = path.dirname(path.join(root, dir)); path.basename(up) !== "services"; up = path.dirname(up)) {
      if (services(up)) break;
      rmSync(up, { recursive: true, force: true });
    }
  }
}

/** Drop removed ids from modules.disabled / modules.only in every settings file, comments kept. */
function cleanConfig(root, removed) {
  const files = CONFIG_FILES.flatMap((name) => {
    const target = path.join(root, name);
    if (!existsSync(target)) return [];
    return name === "configs"
      ? readdirSync(target).filter((f) => f.endsWith(".yaml")).map((f) => path.join(target, f))
      : [target];
  });
  for (const file of files) {
    const doc = parseDocument(readFileSync(file, "utf8"));
    let changed = false;
    for (const key of ["disabled", "only"]) {
      const list = doc.getIn(["modules", key]);
      if (!list || typeof list.toJSON !== "function") continue;
      const ids = list.toJSON().map(String);
      const left = ids.filter((id) => !removed.has(id));
      if (left.length !== ids.length) {
        doc.setIn(["modules", key], left);
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(file, doc.toString());
      console.log(`  updated ${rel(root, file)}`);
    }
  }
}

/** Cut the removed modules' entries out of src/modules/manifest.ts, leaving the rest as written. */
function dropFromManifest(root, ids) {
  const file = path.join(root, "src/modules/manifest.ts");
  let text = readFileSync(file, "utf8");
  for (const id of ids) {
    const at = text.search(new RegExp(`\\bid: "${id}"`));
    if (at < 0) continue;
    const start = text.lastIndexOf("\n  {", at) + 1;
    let depth = 0;
    let end = start;
    for (let i = text.indexOf("{", start); i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      } else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    if (text[end] === ",") end++;
    if (text[end] === "\n") end++;
    text = text.slice(0, start) + text.slice(end);
  }
  writeFileSync(file, text);
}

function applyPlan(root, plan) {
  for (const p of plan.paths) rmSync(path.join(root, p), { recursive: true, force: true });
  dropFromManifest(root, plan.removed.map((m) => m.id));
  pruneEmptyBranches(root, plan.removed.filter((m) => m.kind === "service").map((m) => m.dir));
  if (plan.scripts.length) {
    const file = path.join(root, "package.json");
    const pkg = readJson(file);
    for (const script of plan.scripts) delete pkg.scripts[script];
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  cleanConfig(root, new Set(plan.removed.map((m) => m.id)));
  // Route types Next generated for the deleted routes; the next dev or build writes them afresh.
  rmSync(path.join(root, ".next/types"), { recursive: true, force: true });
  rmSync(path.join(root, ".next/dev/types"), { recursive: true, force: true });
}

function typeCheck(root, { quiet = false } = {}) {
  const tsc = path.join(FRONTEND, "node_modules/typescript/bin/tsc");
  const result = spawnSync(process.execPath, [tsc, "--noEmit", "--incremental", "false", "-p", path.join(root, "tsconfig.json")], {
    cwd: root,
    encoding: "utf8",
  });
  if (!quiet) process.stdout.write(result.stdout);
  return { ok: result.status === 0, output: result.stdout };
}

async function confirmed(flags, question) {
  if (flags.has("--yes")) return true;
  if (!process.stdin.isTTY) {
    console.error("\nNot a terminal — pass --yes to delete without asking.");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\n${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function removeCommand(root, ids, flags, keep) {
  const { modules } = await loadModules(root);
  const unknown = unknownIds(modules, ids);
  if (ids.length === 0 || unknown.length > 0) {
    if (unknown.length) console.error(`Unknown module${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
    console.error(`Usage: npm run modules -- ${keep ? "keep" : "remove"} <id>...   (ids: npm run modules)`);
    return 1;
  }
  const removed = keep ? keepingOnly(modules, ids) : removalOf(modules, ids);
  const extra = [...removed].filter((id) => !ids.includes(id));
  if (removed.size === 0) {
    console.log("Nothing to remove.");
    return 0;
  }
  const plan = planFor(root, modules, removed);
  printPlan(root, plan);
  if (!keep && extra.length) console.log(`\nAlso removed because they need what goes, or nothing left needs them: ${extra.join(", ")}`);
  if (flags.has("--dry-run")) return 0;
  if (!(await confirmed(flags, `Delete ${plan.paths.length} file(s) and folder(s)?`))) return 1;

  applyPlan(root, plan);
  console.log("\nRemoved. git restores any of it: git checkout -- . (inside healthcare-service-kiosk/frontend)");
  if (plan.packages.length) console.log(`Drop the unused packages with: npm uninstall ${plan.packages.join(" ")}`);
  if (flags.has("--no-check")) return 0;
  console.log("\nType-checking what is left…");
  const { ok } = typeCheck(root);
  console.log(ok ? "The kiosk still type-checks." : "\nType errors — something outside the removed modules used them (see above).");
  return ok ? 0 : 1;
}

async function listCommand(root) {
  const { modules } = await loadModules(root);
  const { readKioskConfig } = await import(pathToFileURL(path.join(root, "src/lib/kiosk-config.ts")).href);
  const env = readKioskConfig(root);
  const list = (key) => (process.env[key] ?? env[key] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const disabled = list("NEXT_PUBLIC_KIOSK_MODULES_DISABLED");
  const only = list("NEXT_PUBLIC_KIOSK_MODULES_ONLY");
  const { dependents } = graph(modules);
  const on = (await graphOf(root)).enabledIn(modules, { only, disabled });
  for (const kind of ["feature", "shared", "service"]) {
    console.log(`\n${{ feature: "Features", shared: "Shared parts", service: "Services" }[kind]}`);
    if (!modules.some((x) => x.kind === kind)) console.log("  (none)");
    for (const m of modules.filter((x) => x.kind === kind)) {
      const links = [
        m.requires?.length ? `needs ${m.requires.join(", ")}` : "",
        kind === "shared" ? `used by ${dependents(m.id).join(", ")}` : "",
      ].filter(Boolean).join("; ");
      console.log(`  ${(on(m.id) ? "on " : "off").padEnd(4)}${m.id.padEnd(14)}${m.title.padEnd(30)}${links}`);
    }
  }
  const unknown = unknownIds(modules, [...disabled, ...only]);
  if (unknown.length) console.log(`\nconfig.yaml names modules this kiosk does not have: ${unknown.join(", ")}`);
  console.log("\nSwitch modules in config.yaml (modules.disabled / modules.only) or at /settings; take them out with remove/keep.");
  return 0;
}

async function describeCommand(root, ids) {
  const { modules } = await loadModules(root);
  const { byId, dependents } = graph(modules);
  for (const id of ids) {
    const m = byId.get(id);
    if (!m) {
      console.error(`Unknown module: ${id}`);
      return 1;
    }
    console.log(`\n${m.id} — ${m.title} (${m.kind})`);
    if (m.summary) console.log(`  ${m.summary}`);
    if (m.requires?.length) console.log(`  needs:     ${m.requires.join(", ")}`);
    const users = dependents(m.id);
    if (users.length) console.log(`  needed by: ${users.join(", ")}`);
    console.log("  files:");
    for (const p of m.paths ?? []) console.log(`    ${p}${existsSync(path.join(root, p)) ? "" : "   (missing)"}`);
    if (m.packages?.length) console.log(`  packages:  ${m.packages.join(", ")}`);
    if (m.scripts?.length) console.log(`  scripts:   ${m.scripts.join(", ")}`);
    const removal = [...removalOf(modules, [m.id])].filter((x) => x !== m.id);
    if (removal.length) console.log(`  removing it also removes: ${removal.join(", ")}`);
  }
  return 0;
}

/** Problems with the manifest against the tree; empty when it holds. */
async function manifestProblems(root) {
  const { modules, orphans } = await loadModules(root);
  const problems = [];
  const seen = new Map();
  for (const m of modules) {
    if (seen.has(m.id)) problems.push(`id "${m.id}" is used twice`);
    seen.set(m.id, m);
    for (const need of m.requires ?? []) {
      if (!seen.has(need) && !modules.some((x) => x.id === need)) problems.push(`${m.id} needs "${need}", which is not a module`);
    }
    for (const p of m.paths ?? []) {
      if (!existsSync(path.join(root, p))) problems.push(`${m.id} claims ${p}, which does not exist`);
    }
  }
  for (const m of orphans) problems.push(`the manifest lists service "${m.id}", which has no folder`);
  for (const m of modules.filter((x) => x.kind === "shared")) {
    if (!modules.some((x) => x.requires?.includes(m.id))) problems.push(`shared part ${m.id} is needed by nothing`);
  }
  const claims = modules.flatMap((m) => (m.paths ?? []).map((p) => ({ p, id: m.id })));
  for (const a of claims) {
    for (const b of claims) {
      if (a.id < b.id && (a.p === b.p || a.p.startsWith(`${b.p}/`) || b.p.startsWith(`${a.p}/`))) {
        problems.push(`${a.p} (${a.id}) and ${b.p} (${b.id}) overlap`);
      }
    }
  }
  return { modules, problems };
}

/** A copy of the frontend to cut into, sharing node_modules. */
function scratchCopy(root) {
  const copy = mkdtempSync(path.join(tmpdir(), "kiosk-modules-"));
  for (const entry of readdirSync(root)) {
    if (COPY_SKIP.has(entry) || entry.startsWith("db.sqlite")) continue;
    cpSync(path.join(root, entry), path.join(copy, entry), { recursive: true });
  }
  symlinkSync(path.join(root, "node_modules"), path.join(copy, "node_modules"), "junction");
  return copy;
}

async function checkCommand(root, flags) {
  const { modules, problems } = await manifestProblems(root);
  if (problems.length) {
    console.log("The manifest (src/modules/manifest.ts) does not match the tree:");
    for (const problem of problems) console.log(`  - ${problem}`);
    return 1;
  }
  console.log(`Manifest OK: ${modules.length} modules.`);
  if (!flags.has("--deep")) return 0;

  const targets = flags.has("--only") ? modules.filter((m) => flags.get("--only").includes(m.id)) : modules;
  let failed = 0;
  for (const m of targets) {
    const copy = scratchCopy(root);
    try {
      const { modules: inCopy } = await loadModules(copy);
      const removed = removalOf(inCopy, [m.id]);
      applyPlan(copy, planFor(copy, inCopy, removed));
      const left = (await manifestProblems(copy)).problems;
      const checked = typeCheck(copy, { quiet: true });
      const ok = checked.ok && left.length === 0;
      const output = [...left.map((problem) => `manifest: ${problem}`), checked.output].join("\n");
      console.log(`  ${ok ? "ok  " : "FAIL"} remove ${m.id}${removed.size > 1 ? ` (with ${[...removed].filter((x) => x !== m.id).join(", ")})` : ""}`);
      if (!ok) {
        failed++;
        console.log(output.split("\n").filter(Boolean).slice(0, 12).map((line) => `         ${line}`).join("\n"));
      }
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  }
  console.log(failed ? `\n${failed} module(s) cannot be removed on their own.` : "\nEvery module can be removed on its own.");
  return failed ? 1 : 0;
}

function parseArgs(argv) {
  const flags = new Map();
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--only") flags.set("--only", (argv[++i] ?? "").split(","));
    else if (arg.startsWith("--")) flags.set(arg, true);
    else words.push(arg);
  }
  return { command: words[0] ?? "list", ids: words.slice(1), flags };
}

const { command, ids, flags } = parseArgs(process.argv.slice(2));
const commands = {
  list: () => listCommand(FRONTEND),
  describe: () => describeCommand(FRONTEND, ids),
  remove: () => removeCommand(FRONTEND, ids, flags, false),
  keep: () => removeCommand(FRONTEND, ids, flags, true),
  check: () => checkCommand(FRONTEND, flags),
};
if (!(command in commands)) {
  console.error(`Unknown command "${command}" — use list, describe, remove, keep or check.`);
  process.exit(2);
}
process.exit(await commands[command]());
