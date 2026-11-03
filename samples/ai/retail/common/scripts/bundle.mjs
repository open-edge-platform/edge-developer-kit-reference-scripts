#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Build the embedded bundle: a minimal (non-Electron) Edge AI Studio export
 * with every chosen kiosk of the Vertical Reference Solutions Blueprint
 * injected as a studio sample, each started by the studio as a hidden worker
 * process — like the Edge AI suites.
 *
 * One script for both platforms: scripts/bundle.sh and the Windows launchers
 * run it on the Node the kit already requires. Invoked by scripts/build.sh /
 * scripts\build.bat (bundle args pass through), or directly. See
 * docs/embedded-studio.md.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { installDeployment, instances, kioskTerminalMode, online, onlineServices, resolveDeployment } from "./studio-deployment.mjs";
import { chosenKiosks, modeArgs, resolveModes } from "./kiosks.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ELECTRON_DIR = path.join(REPO_ROOT, "electron");
const WINDOWS = process.platform === "win32";

const tty = process.stdout.isTTY;
const BOLD = tty ? "\x1b[1m" : "", GREEN = tty ? "\x1b[32m" : "";
const YELLOW = tty ? "\x1b[33m" : "", RED = tty ? "\x1b[31m" : "", RESET = tty ? "\x1b[0m" : "";
const info = (m) => console.log(`${BOLD}==>${RESET} ${m}`);
const ok = (m) => console.log(`${GREEN} ✓ ${RESET} ${m}`);
const warn = (m) => console.error(`${YELLOW}warning:${RESET} ${m}`);
const die = (m) => { console.error(`${RED}error:${RESET} ${m}`); process.exit(1); };

// .kioskrc is a shell file shared with the bash launchers; read the KEY=value
// lines it realistically holds (env vars win, like everywhere else).
function loadKioskRc() {
  const rc = path.join(REPO_ROOT, ".kioskrc");
  if (!fs.existsSync(rc)) return;
  for (const line of fs.readFileSync(rc, "utf8").split("\n")) {
    const match = line.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || line.trim().startsWith("#")) continue;
    let [, name, value] = match;
    value = value.trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    value = value.replaceAll("$HOME", os.homedir()).replaceAll("${HOME}", os.homedir());
    if (process.env[name] === undefined || process.env[name] === "") process.env[name] = value;
  }
}
loadKioskRc();

const setting = (name, fallback) => process.env[name] || fallback;
// Relative path settings resolve against common/, where .kioskrc lives — never the caller's cwd.
const kitPath = (value) => value && path.resolve(REPO_ROOT, value);
const EDGE_AI_STUDIO_DIR = kitPath(setting("EDGE_AI_STUDIO_DIR", path.resolve(REPO_ROOT, "..", "..", "edge-ai-demo-studio")));
const KIOSK_PROFILE = setting("KIOSK_PROFILE", "reference");
const STUDIO_DEPLOYMENT_MANAGE = setting("STUDIO_DEPLOYMENT_MANAGE", "1");
const STUDIO_LLAMACPP_BACKEND = setting("STUDIO_LLAMACPP_BACKEND", "sycl");


function runOk(argv, { cwd, env, replaceEnv = false } = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd, stdio: "inherit", env: env ? (replaceEnv ? env : { ...process.env, ...env }) : process.env,
  });
  if (result.error) die(`could not run ${argv[0]}: ${result.error.message}`);
  if (result.status !== 0) die(`\`${argv.join(" ")}\` exited with ${result.status}`);
}

function git(args, opts = {}) {
  return spawnSync("git", ["-C", EDGE_AI_STUDIO_DIR, ...args], { stdio: "pipe", ...opts });
}

let KIOSKS;
try {
  KIOSKS = chosenKiosks();
} catch (error) {
  die(error.message);
}
const KIOSK_LIST = KIOSKS.map((k) => k.id).join(", ");

function usage() {
  console.log(`Usage: scripts/bundle.mjs [options]   (also reached via: scripts/build.sh -- [options])

Produces build/kiosk-studio/ at the repo root: a source export of the Edge AI Studio (no
Electron) carrying its full AI service catalog, with every chosen kiosk
(${KIOSK_LIST}) injected as a sample of its gallery. The studio starts each
kiosk as a hidden child process (workers/<kiosk.json studio.sampleId>) and its
samples gallery links to each kiosk's UI. The launchers choose the kiosks
(KIOSK_DIR_LIST, else KIOSK_DIR).

Options:
  --mode [<kiosk>=]<mode>    terminal mode, one of the kiosk's deployment.json
                             modes: a plain <mode> sets every kiosk's,
                             <kiosk>=<mode> one kiosk's (repeat it per kiosk).
                             The modes' online services are what the bundle
                             auto-starts (the LLM follows --llm) and what the
                             checkout must have. Every service is exported
                             either way.
                             default: each kiosk's configured mode
  --llm <remote|local>       where the LLM runs: remote = Gemini in the cloud
                             (or the remote llm.base_url config.yaml names), no
                             text-generation started here; local = the platform
                             runs it with the mode's text-generation preset.
                             default: local when a kiosk's mode runs text-generation
  --out <dir>                output directory (default: build/kiosk-studio)
  --port <n>                 port the embedded kiosk listens on, for a one-kiosk
                             bundle (default, and always with several: each
                             kiosk.json's studio.port)
  --install                  run the bundle's own setup afterwards (npm install,
                             worker venvs, frontend build — long, downloads a lot)
  --skip-stage               reuse the kiosks' last stage (<out>/.stage/)
  --allow-missing            build even if the studio checkout lacks some of the
                             mode's services (default: hard error — no silent
                             fallback to degraded/mocked kiosk features)
  --brand <name>             display name the exported studio is rebranded to
                             (default: "Vertical Reference Solutions Blueprint"; also via
                             STUDIO_BRAND_NAME)
  -h, --help                 this help`);
}

let LLM = "", OUT = "", PORT = "";
let INSTALL = false, SKIP_STAGE = false, ALLOW_MISSING = false;
let BRAND = setting("STUDIO_BRAND_NAME", "Vertical Reference Solutions Blueprint");

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const [name, inline] = argv[i].startsWith("--") && argv[i].includes("=")
    ? [argv[i].slice(0, argv[i].indexOf("=")), argv[i].slice(argv[i].indexOf("=") + 1)]
    : [argv[i], undefined];
  const value = () => inline ?? argv[++i] ?? "";
  switch (name) {
    case "--mode": value(); break; // collected by modeArgs below
    case "--llm": LLM = value(); break;
    case "--out": OUT = value(); break;
    case "--port": PORT = value(); break;
    case "--install": INSTALL = true; break;
    case "--skip-stage": SKIP_STAGE = true; break;
    case "--allow-missing": ALLOW_MISSING = true; break;
    case "--brand": BRAND = value(); if (!BRAND) die("--brand needs a value"); break;
    case "-h": case "--help": usage(); process.exit(0); break;
    default: usage(); die(`unknown option: ${argv[i]}`);
  }
}

try {
  resolveModes(KIOSKS, modeArgs(argv), (kiosk) => kioskTerminalMode(kiosk.dir, KIOSK_PROFILE));
} catch (error) {
  die(error.message);
}
if (PORT) {
  if (KIOSKS.length > 1) die(`--port is for a one-kiosk bundle — ${KIOSK_LIST} each keep their kiosk.json studio.port`);
  if (!/^\d+$/.test(PORT)) die(`--port takes a number, not "${PORT}"`);
  KIOSKS[0].port = Number(PORT);
} else if (KIOSKS.length === 1 && process.env.KIOSK_BUNDLE_PORT) {
  KIOSKS[0].port = Number(process.env.KIOSK_BUNDLE_PORT);
}
const MODES = KIOSKS.map((k) => `${k.id}=${k.mode}`).join(", ");

OUT = OUT || path.join(REPO_ROOT, "..", "build", "kiosk-studio");
const STUDIO_OUT = path.join(OUT, "studio");
const TEMPLATES = path.join(REPO_ROOT, "scripts", "bundle");
const STAGE = path.join(ELECTRON_DIR, "resources");
// Each kiosk's stage is kept here between its staging and the export, and for --skip-stage.
const HELD_STAGES = path.join(OUT, ".stage");

let RESOLVED;
try {
  RESOLVED = resolveDeployment(KIOSKS.map(({ dir, mode }) => ({ dir, mode })), { file: kitPath(process.env.STUDIO_DEPLOYMENT_FILE), warn });
} catch (error) {
  die(error.message);
}
const DEPLOYMENT = structuredClone(RESOLVED.deployment);
const LLM_PRESET = instances(DEPLOYMENT.services["text-generation"]);
LLM = LLM || (online(LLM_PRESET) ? "local" : "remote");
if (LLM !== "local" && LLM !== "remote") die(`--llm takes remote or local, not "${LLM}"`);
// --llm turns every text-generation instance the modes list on or off.
DEPLOYMENT.services["text-generation"] = (LLM_PRESET.length ? LLM_PRESET : [{}]).map((instance) => ({
  ...instance,
  status: LLM === "local" ? "online" : "offline",
}));
let KIOSK_SERVICES = onlineServices(DEPLOYMENT);

if (!fs.existsSync(EDGE_AI_STUDIO_DIR)) die(`Edge AI Studio not found at ${EDGE_AI_STUDIO_DIR} (set EDGE_AI_STUDIO_DIR)`);
const EXPORTER = path.join(EDGE_AI_STUDIO_DIR, "scripts", "export-bundle.mjs");
if (!fs.existsSync(EXPORTER)) die(`${EXPORTER} not found — this studio checkout has no export support`);

// The studio's service roster changes across branches (face-recognition lives
// on a feature branch until it merges). Never degrade silently: a service the
// kiosk mode needs but the checkout lacks is a hard error — the fix is to
// check out the studio branch that has it. --allow-missing is the explicit
// opt-in to build a reduced bundle anyway.
const MISSING_SERVICES = KIOSK_SERVICES.filter(
  (s) => !fs.existsSync(path.join(EDGE_AI_STUDIO_DIR, "frontend", "src", "services", s, "data.ts")),
);
if (MISSING_SERVICES.length) {
  if (ALLOW_MISSING) {
    warn(`building WITHOUT ${MISSING_SERVICES.join(" ")} (--allow-missing) — those kiosk features will be degraded`);
    KIOSK_SERVICES = KIOSK_SERVICES.filter((s) => !MISSING_SERVICES.includes(s));
    if (!KIOSK_SERVICES.length) die("none of the kiosk's services exist in this studio checkout");
  } else {
    die(`this studio checkout (${EDGE_AI_STUDIO_DIR}) is missing: ${MISSING_SERVICES.join(" ")}
The kiosks' modes (${MODES}) need them. Check out the studio branch that provides them
(git -C "$EDGE_AI_STUDIO_DIR" branch -a), or pass --allow-missing to
knowingly build a reduced bundle without them.`);
  }
}

// The bundle ships the studio's whole service catalog, not just the kiosk's
// dependencies — the demo studio is meant to show every service it has. Samples
// are the opposite: the exporter keeps only the ones named by --samples, so the
// injected kiosks end up as the gallery's only tiles.
const listing = spawnSync(process.execPath, [EXPORTER, "--list", "--json"], {
  cwd: EDGE_AI_STUDIO_DIR, encoding: "utf8",
});
let ALL_SERVICES = [];
try { ALL_SERVICES = JSON.parse(listing.stdout).services; } catch { /* handled below */ }
if (listing.status !== 0 || !ALL_SERVICES?.length) die("could not list the studio's services (export-bundle.mjs --list --json)");

// Services whose worker sits outside workers/ (workerSubDir '../workers-oep/…')
// are left out: the exporter resolves the dir as `workers/..` and copies the
// studio's entire repo — samples included, which defeats the pruning.
function serviceDataFile(service) {
  const root = path.join(EDGE_AI_STUDIO_DIR, "frontend", "src", "services");
  const walk = (dir, depth) => {
    if (depth > 1) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sub = path.join(dir, entry.name);
      if (entry.name === service && fs.existsSync(path.join(sub, "data.ts"))) return path.join(sub, "data.ts");
      const found = walk(sub, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(root, 0);
}
const SKIPPED_SERVICES = [];
const SERVICES = ALL_SERVICES.filter((s) => {
  const data = serviceDataFile(s);
  if (data && fs.readFileSync(data, "utf8").includes("workerSubDir: '../")) {
    SKIPPED_SERVICES.push(s);
    return false;
  }
  return true;
});
if (!SERVICES.length) die(`no exportable services in ${EDGE_AI_STUDIO_DIR}`);
if (SKIPPED_SERVICES.length) {
  info(`Leaving out ${SKIPPED_SERVICES.length} service(s) whose worker lives outside workers/: ${SKIPPED_SERVICES.join(" ")}`);
}
for (const s of KIOSK_SERVICES) {
  if (!SERVICES.includes(s)) die(`${s} is not exportable but the kiosks' modes (${MODES}) need it`);
}

info(`Embedded bundle: ${KIOSKS.map((k) => `${k.id} (mode ${k.mode}, port ${k.port})`).join(", ")}; LLM=${LLM}`);
info(`Exporting all ${SERVICES.length} studio services (kiosks need: ${KIOSK_SERVICES.join(",")})`);
info(`Output: ${OUT}`);

// 1. Stage each kiosk's standalone server (server + assets + primed db +
// config). The electron stage is one directory, so each kiosk's is moved out
// of it into .stage/<sample id> before the next kiosk is staged.
const STAGED = ["server", "assets", "database", "config.yaml"];
function newerThan(entry, stagedAt) {
  if (!fs.existsSync(entry)) return false;
  if (fs.statSync(entry).isFile()) return fs.statSync(entry).mtimeMs > stagedAt;
  return fs.readdirSync(entry).some((name) => newerThan(path.join(entry, name), stagedAt));
}
fs.mkdirSync(HELD_STAGES, { recursive: true });
for (const kiosk of KIOSKS) {
  kiosk.stage = path.join(HELD_STAGES, kiosk.sampleId);
  const frontend = path.join(kiosk.dir, "frontend");
  if (SKIP_STAGE && fs.existsSync(path.join(kiosk.stage, "server"))) {
    info(`Reusing the ${kiosk.id} kiosk's last stage (${kiosk.stage})`);
    const configYaml = path.join(kiosk.stage, "config.yaml");
    const stagedAt = fs.existsSync(configYaml) ? fs.statSync(configYaml).mtimeMs : 0;
    if (stagedAt && (newerThan(path.join(frontend, "src"), stagedAt) || newerThan(path.join(frontend, "package.json"), stagedAt))) {
      warn(`the reused ${kiosk.id} stage is OLDER than its current frontend sources — a stale`);
      warn("stage can crash the embedded kiosk (module mismatches); drop --skip-stage to rebuild it");
    }
    continue;
  }
  info(`Staging the ${kiosk.id} kiosk server (electron stage, mode=${kiosk.mode}, live AI)`);
  const env = { ...process.env, KIOSK_DIR: kiosk.dir };
  delete env.KIOSK_DIR_LIST;
  runOk([process.execPath, path.join(ELECTRON_DIR, "scripts", "build.mjs"), "--stage-only", `--mode=${kiosk.mode}`, `--llm=${LLM}`, "--live"],
    { cwd: ELECTRON_DIR, env, replaceEnv: true });
  if (!fs.existsSync(path.join(STAGE, "server"))) die(`${kiosk.id} kiosk stage failed — ${path.join(STAGE, "server")} missing`);
  fs.rmSync(kiosk.stage, { recursive: true, force: true });
  fs.mkdirSync(kiosk.stage, { recursive: true });
  for (const entry of STAGED) {
    if (fs.existsSync(path.join(STAGE, entry))) fs.renameSync(path.join(STAGE, entry), path.join(kiosk.stage, entry));
  }
}
for (const kiosk of KIOSKS) {
  for (const entry of STAGED) {
    if (!fs.existsSync(path.join(kiosk.stage, entry))) die(`the ${kiosk.id} kiosk stage has no ${entry} (${kiosk.stage}) — drop --skip-stage to rebuild it`);
  }
}

// 2. Register the kiosks in the studio checkout, temporarily, so the studio's
// own samples-driven exporter can resolve them: `--samples=<sample ids>`
// makes the kiosks the only samples carried over, while `--services=…` asks
// for the full catalog. The exporter only copies git-visible files, so the
// injected files are made visible with `git add -N` (intent-to-add — nothing
// is staged or committed) and removed again right after the export, success
// or failure.
for (const kiosk of KIOSKS) {
  kiosk.injected = [
    `frontend/src/services/${kiosk.sampleId}`,
    `frontend/src/samples/${kiosk.sampleId}`,
    `workers/${kiosk.sampleId}`,
  ];
  [kiosk.srcService, kiosk.srcSample, kiosk.srcWorker] =
    kiosk.injected.map((p) => path.join(EDGE_AI_STUDIO_DIR, ...p.split("/")));
}
const INJECTED = KIOSKS.flatMap((k) => k.injected);
const INJECTED_DIRS = KIOSKS.flatMap((k) => [k.srcService, k.srcSample, k.srcWorker]);
for (const dir of INJECTED_DIRS) {
  if (fs.existsSync(dir)) die(`${dir} already exists in the studio checkout — remove it first (a previous bundle run may have been interrupted)`);
}
if (git(["rev-parse", "--is-inside-work-tree"]).status !== 0) {
  die(`${EDGE_AI_STUDIO_DIR} is not a git checkout — the studio exporter needs one`);
}

function cleanupStudioInjection() {
  git(["reset", "-q", "--", ...INJECTED]);
  for (const dir of INJECTED_DIRS) fs.rmSync(dir, { recursive: true, force: true });
}
const onSignal = () => { cleanupStudioInjection(); process.exit(130); };
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

// The templates are written for the public-service kiosk; each kiosk's
// kiosk.json studio block fills in its own id, title, port and tile.
function render(template, kiosk) {
  const studio = kiosk.json.studio;
  const icon = studio.icon || "Landmark";
  if (!/^[A-Z][A-Za-z0-9]*$/.test(icon)) die(`${kiosk.id}: kiosk.json studio.icon must be a lucide-react icon name, not "${icon}"`);
  const description = studio.description || `${kiosk.title} — a self-service kiosk running embedded in the studio.`;
  const tags = Array.isArray(studio.tags) && studio.tags.length ? studio.tags : ["Kiosk"];
  return fs.readFileSync(path.join(TEMPLATES, template), "utf8")
    .replaceAll("__KIOSK_PORT__", String(kiosk.port))
    .replaceAll("__ICON__", icon)
    .replaceAll("__DESCRIPTION__", JSON.stringify(description))
    .replaceAll("__TAGS__", JSON.stringify(tags.map(String)))
    .replaceAll("public-service-kiosk", kiosk.sampleId)
    .replaceAll("Public Service Kiosk", kiosk.title);
}

info(`Registering the kiosk samples in the studio checkout (temporary, via git add -N): ${KIOSKS.map((k) => k.sampleId).join(", ")}`);
try {
  for (const kiosk of KIOSKS) {
    for (const dir of [kiosk.srcService, kiosk.srcSample, kiosk.srcWorker]) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(kiosk.srcService, "data.ts"), render("service-data.ts", kiosk));
    // Drop dependency lines for services this studio version doesn't have — the
    // exporter resolves deps from these literal lines and crashes on unknown ids.
    const sample = render("sample-data.ts", kiosk).split("\n")
      .filter((line) => !MISSING_SERVICES.some((s) => line.includes(`serviceId: '${s}'`)))
      .join("\n");
    fs.writeFileSync(path.join(kiosk.srcSample, "data.ts"), sample);
    // The gallery tile's image: kiosk.json studio.image (relative to the kiosk
    // folder), else the first frame of docs/media/touch-kiosk-flow.gif.
    const image = kiosk.json.studio.image
      ? path.resolve(kiosk.dir, kiosk.json.studio.image)
      : path.join(TEMPLATES, "sample-image.png");
    if (!fs.existsSync(image)) die(`${kiosk.id}: the sample image ${image} does not exist`);
    fs.copyFileSync(image, path.join(kiosk.srcSample, "image.png"));
    // Both platforms' worker entry points, whichever platform builds the bundle:
    // the studio's process handler runs start.sh via bash on Linux and start.ps1
    // via powershell on Windows.
    fs.writeFileSync(path.join(kiosk.srcWorker, "start.sh"), render("worker-start.sh", kiosk), { mode: 0o755 });
    fs.writeFileSync(path.join(kiosk.srcWorker, "start.ps1"), render("worker-start.ps1", kiosk));
  }
  if (git(["add", "-N", ...INJECTED]).status !== 0) die("git add -N failed in the studio checkout");

  // 3. Export the minimal studio (source tree; no Electron, no models)
  info("Exporting the studio: all services, the kiosk samples only");
  fs.rmSync(STUDIO_OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  runOk([process.execPath, EXPORTER,
    `--samples=${KIOSKS.map((k) => k.sampleId).join(",")}`, `--services=${SERVICES.join(",")}`, `--out=${STUDIO_OUT}`],
    { cwd: EDGE_AI_STUDIO_DIR });
} finally {
  cleanupStudioInjection();
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
}

if (!fs.existsSync(path.join(STUDIO_OUT, "frontend", "src"))) die(`studio export failed — ${path.join(STUDIO_OUT, "frontend", "src")} missing`);

// 3a. Drop each kiosk's server payload into its exported worker
for (const kiosk of KIOSKS) {
  const exportedSample = path.join(STUDIO_OUT, "frontend", "src", "samples", kiosk.sampleId);
  if (!fs.existsSync(path.join(exportedSample, "data.ts"))) die(`export did not carry the ${kiosk.sampleId} sample — check the exporter output above`);
  if (!fs.existsSync(path.join(exportedSample, "image.png"))) die(`export did not carry the ${kiosk.sampleId} sample image — the studio build needs it (data.ts imports it)`);

  info(`Copying the staged ${kiosk.id} kiosk server into workers/${kiosk.sampleId}/bundle`);
  const worker = path.join(STUDIO_OUT, "workers", kiosk.sampleId);
  if (!fs.existsSync(path.join(worker, "start.sh"))) die(`export did not carry workers/${kiosk.sampleId}/start.sh`);
  if (!fs.existsSync(path.join(worker, "start.ps1"))) die(`export did not carry workers/${kiosk.sampleId}/start.ps1`);
  fs.chmodSync(path.join(worker, "start.sh"), 0o755);
  fs.mkdirSync(path.join(worker, "bundle"), { recursive: true });
  // verbatimSymlinks: the staged server's node_modules carry relative symlinks
  // (see electron/scripts/build.mjs stage()) that must not be rewritten.
  for (const entry of STAGED) {
    fs.cpSync(path.join(kiosk.stage, entry), path.join(worker, "bundle", entry), { recursive: true, verbatimSymlinks: true });
  }
}

// 3b. Rebrand the exported studio: overwrite its display name everywhere in
// the frontend source (it is a hardcoded string, not a constant) before the
// frontend build bakes it into the UI, page titles and sidebar.
info(`Rebranding the studio as "${BRAND}"`);
function rebrand(file) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("Edge AI Demo Studio") && !text.includes("Demo Studio")) return;
  fs.writeFileSync(file, text.replaceAll("Edge AI Demo Studio", BRAND).replaceAll("Demo Studio", BRAND));
}
function walkFiles(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const sub = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(sub, visit);
    else if (entry.isFile()) visit(sub);
  }
}
walkFiles(path.join(STUDIO_OUT, "frontend", "src"), (file) => {
  if (file.endsWith(".ts") || file.endsWith(".tsx")) rebrand(file);
});
if (fs.existsSync(path.join(STUDIO_OUT, "README.md"))) rebrand(path.join(STUDIO_OUT, "README.md"));

// 4. Widen the generated registries' key types: the kiosks' ids are not in the
// studio's baked Payload type union (the exporter already widens serviceMap;
// these two are the remaining union-typed spots in codegen).
const CODEGEN = path.join(STUDIO_OUT, "frontend", "scripts", "generate-registries.mjs");
fs.writeFileSync(CODEGEN, fs.readFileSync(CODEGEN, "utf8")
  .replace('Partial<Record<Service["type"], WorkerConfig>>', "Partial<Record<string, WorkerConfig>>")
  .replace('type: Service["type"],', "type: string,"));

// 5. Re-run codegen so the injected services + samples enter the registries
info("Regenerating studio registries");
runOk([process.execPath, path.join("scripts", "generate-registries.mjs")], { cwd: path.join(STUDIO_OUT, "frontend") });
const meta = fs.readFileSync(path.join(STUDIO_OUT, "frontend", "src", "services", "_generated", "meta.ts"), "utf8");
const samples = fs.readFileSync(path.join(STUDIO_OUT, "frontend", "src", "samples", "_generated", "samples.ts"), "utf8");
for (const kiosk of KIOSKS) {
  if (!meta.includes(kiosk.sampleId)) die(`codegen did not pick up the ${kiosk.sampleId} service`);
  if (!samples.includes(kiosk.sampleId)) die(`codegen did not pick up the ${kiosk.sampleId} sample`);
}
const sampleCount = (samples.match(/^import \{ sample as/gm) || []).length;
if (sampleCount !== KIOSKS.length) {
  die(`the exported gallery carries ${sampleCount} samples — expected only ${KIOSKS.map((k) => k.sampleId).join(", ")}`);
}

// 6. Pre-seed the bundled runtimes from the studio checkout when present, so
// the bundle's setup doesn't have to download them again (it still can).
if (fs.existsSync(path.join(EDGE_AI_STUDIO_DIR, "thirdparty", "node"))
  && !fs.existsSync(path.join(STUDIO_OUT, "thirdparty", "node"))) {
  info("Seeding bundled runtimes (thirdparty/) from the studio checkout");
  fs.mkdirSync(path.join(STUDIO_OUT, "thirdparty"), { recursive: true });
  fs.cpSync(path.join(EDGE_AI_STUDIO_DIR, "thirdparty", "node"), path.join(STUDIO_OUT, "thirdparty", "node"),
    { recursive: true, verbatimSymlinks: true });
  if (fs.existsSync(path.join(EDGE_AI_STUDIO_DIR, "thirdparty", "ffmpeg"))) {
    fs.cpSync(path.join(EDGE_AI_STUDIO_DIR, "thirdparty", "ffmpeg"), path.join(STUDIO_OUT, "thirdparty", "ffmpeg"),
      { recursive: true, verbatimSymlinks: true });
  }
}

// 7. Deployment presets: every kiosk's mode services + auto-start for each
// embedded kiosk. (The exporter does not carry deployment.json, so the bundle
// gets its own.)
info(`Writing bundle deployment.json (services for ${RESOLVED.source || MODES} + ${KIOSKS.map((k) => k.sampleId).join(", ")} autostart)`);
DEPLOYMENT.services = Object.fromEntries(
  Object.entries(DEPLOYMENT.services).filter(([name]) => SERVICES.includes(name)),
);
for (const kiosk of KIOSKS) DEPLOYMENT.services[kiosk.sampleId] = { status: "online" };
fs.writeFileSync(path.join(STUDIO_OUT, "deployment.json"), JSON.stringify(DEPLOYMENT, null, 2));

// The checkout gets the modes' services as the kiosks list them (no LLM override, no kiosk autostart).
if (STUDIO_DEPLOYMENT_MANAGE === "1" && fs.existsSync(EDGE_AI_STUDIO_DIR)) {
  installDeployment(EDGE_AI_STUDIO_DIR, RESOLVED, { info, ok });
}

// 8. Bundle metadata + top-level README. bundle.env lists the kiosks as
// parallel space-separated lists, which both the bash and the PowerShell
// launchers read without a JSON parser.
const list = (key) => KIOSKS.map((k) => k[key]).join(" ");
fs.writeFileSync(path.join(OUT, "bundle.env"), `# Written by scripts/bundle.mjs — read by start.sh / start_win.bat --bundle and the desktop build
KIOSK_BUNDLE_KIOSKS="${list("id")}"
KIOSK_BUNDLE_SAMPLES="${list("sampleId")}"
KIOSK_BUNDLE_PORTS="${list("port")}"
KIOSK_BUNDLE_MODES="${list("mode")}"
KIOSK_BUNDLE_LLM=${LLM}
KIOSK_BUNDLE_BRAND="${BRAND}"
`);
const rows = KIOSKS.map((k) => `| ${k.title} | \`${k.sampleId}\` | ${k.mode} | http://127.0.0.1:${k.port} |`).join("\n");
fs.writeFileSync(path.join(OUT, "README.md"), `# ${BRAND} bundle

${BRAND} carrying the studio's full service catalog (${SERVICES.length} services),
with ${KIOSKS.length === 1 ? "one kiosk as its only sample" : `${KIOSKS.length} kiosks as its samples`}. The platform starts each kiosk
as a hidden worker process and auto-starts the kiosks plus the services their
modes run (${KIOSK_SERVICES.join(",")}) per \`studio/deployment.json\`; the rest
are exported but idle until started from the studio UI.

| Kiosk | Sample | Mode | URL |
|---|---|---|---|
${rows}

LLM: **${LLM === "local" ? "on this machine" : "remote (set llm.api_key at each kiosk's /settings)"}**

    cd studio
    sudo ./install_dependencies.sh   # once, system packages (Linux)
    ./setup.sh                       # once, runtimes + worker venvs + frontend build
    ./start.sh                       # studio gateway on :8080, the kiosks on their ports

On Windows, run \`setup_win.bat\` and \`start_win.bat\` instead (no
install_dependencies step). Or from the kiosk repo: \`./start.sh --bundle\` /
\`start_win.bat --bundle\` (add \`--desktop\` for the desktop shell).
Studio: http://127.0.0.1:8080 — each kiosk is a tile of its samples gallery.
`);

// Bundles from before the kiosks shared one studio: build/kiosk-studio/<kiosk id>/.
for (const entry of fs.readdirSync(OUT, { withFileTypes: true })) {
  const legacy = path.join(OUT, entry.name);
  if (entry.isDirectory() && fs.existsSync(path.join(legacy, "bundle.env")) && fs.existsSync(path.join(legacy, "studio"))) {
    info(`Removing ${legacy} — a per-kiosk bundle from an earlier build; every kiosk is in ${STUDIO_OUT} now`);
    fs.rmSync(legacy, { recursive: true, force: true });
  }
}

ok(`Bundle staged at ${OUT} (samples: ${KIOSKS.map((k) => k.sampleId).join(", ")})`);
const setupCmd = WINDOWS ? ["cmd.exe", "/c", "setup_win.bat"] : ["bash", "./setup.sh"];
if (INSTALL) {
  info("Running the bundle's setup (this installs worker environments and builds the frontend — long)");
  runOk(setupCmd, { cwd: STUDIO_OUT, env: { BackendChoice: STUDIO_LLAMACPP_BACKEND } });
  ok(`Bundle is ready — start it with: ${WINDOWS ? "start_win.bat" : "./start.sh"} --bundle`);
} else if (WINDOWS) {
  info(`Next: (cd ${STUDIO_OUT} && setup_win.bat) or setup_win.bat --bundle, then start_win.bat --bundle`);
} else {
  info(`Next: (cd ${STUDIO_OUT} && bash ./setup.sh) or ./setup.sh --bundle, then ./start.sh --bundle`);
}
