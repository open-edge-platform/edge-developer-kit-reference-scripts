#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Build the embedded bundle: a minimal (non-Electron) Edge AI Studio export
 * with the Vertical Reference Solutions Blueprint injected as a studio sample,
 * started by the studio as a hidden worker process — like the Edge AI suites.
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
import { installDeployment, kioskTerminalMode, onlineServices, resolveDeployment } from "./studio-deployment.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KIOSK_DIR = path.resolve(REPO_ROOT, "..", process.env.KIOSK_DIR || "public-service-kiosk");
process.env.KIOSK_DIR = KIOSK_DIR;
const FRONTEND_DIR = path.join(KIOSK_DIR, "frontend");
const KIOSK = JSON.parse(fs.readFileSync(path.join(KIOSK_DIR, "kiosk.json"), "utf8"));
const SAMPLE_ID = KIOSK.studio.sampleId;
const KIOSK_FOLDER = path.basename(KIOSK_DIR);
const SAMPLE_TITLE = KIOSK.studio.title;
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
const EDGE_AI_STUDIO_DIR = setting("EDGE_AI_STUDIO_DIR", path.resolve(REPO_ROOT, "..", "..", "edge-ai-demo-studio"));
const KIOSK_PROFILE = setting("KIOSK_PROFILE", "reference");
const STUDIO_DEPLOYMENT_MANAGE = setting("STUDIO_DEPLOYMENT_MANAGE", "1");


function runOk(argv, { cwd, env } = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd, stdio: "inherit", env: env ? { ...process.env, ...env } : process.env,
  });
  if (result.error) die(`could not run ${argv[0]}: ${result.error.message}`);
  if (result.status !== 0) die(`\`${argv.join(" ")}\` exited with ${result.status}`);
}

function git(args, opts = {}) {
  return spawnSync("git", ["-C", EDGE_AI_STUDIO_DIR, ...args], { stdio: "pipe", ...opts });
}

function usage() {
  console.log(`Usage: scripts/bundle.mjs [options]   (also reached via: scripts/build.sh -- [options])

Produces build/kiosk-studio/<kiosk>/ at the repo root: a source export of the Edge AI Studio (no
Electron) carrying its full AI service catalog, with the kiosk injected as the
gallery's only sample. The studio starts the kiosk as a hidden child process
(workers/<kiosk.json studio.sampleId>) and its samples gallery links to the kiosk UI.

Options:
  --mode <mode>              kiosk terminal mode, one of ${KIOSK_FOLDER}/deployment.json's
                             modes; its online services are what the bundle
                             auto-starts (the LLM follows --llm) and what the
                             checkout must have. Every service is exported
                             either way.
                             default: the kiosk's configured mode (${kioskTerminalMode(KIOSK_DIR, KIOSK_PROFILE)})
  --llm <remote|local>       where the LLM runs: remote = Gemini in the cloud
                             (or the remote llm.base_url config.yaml names), no
                             text-generation started here; local = the platform
                             runs it with the mode's text-generation preset.
                             default: local when the mode runs text-generation
  --out <dir>                output directory (default: build/kiosk-studio/${KIOSK.id})
  --port <n>                 port the embedded kiosk listens on (default: kiosk.json studio.port)
  --install                  run the bundle's own setup afterwards (npm install,
                             worker venvs, frontend build — long, downloads a lot)
  --skip-stage               reuse the existing kiosk stage (electron/resources)
  --allow-missing            build even if the studio checkout lacks some of the
                             mode's services (default: hard error — no silent
                             fallback to degraded/mocked kiosk features)
  --brand <name>             display name the exported studio is rebranded to
                             (default: "Vertical Reference Solutions Blueprint"; also via
                             STUDIO_BRAND_NAME)
  -h, --help                 this help`);
}

let MODE = "", LLM = "", OUT = "", PORT = setting("KIOSK_BUNDLE_PORT", String(KIOSK.studio.port));
let INSTALL = false, SKIP_STAGE = false, ALLOW_MISSING = false;
let BRAND = setting("STUDIO_BRAND_NAME", "Vertical Reference Solutions Blueprint");

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  switch (argv[i]) {
    case "--mode": MODE = argv[++i] ?? ""; break;
    case "--llm": LLM = argv[++i] ?? ""; break;
    case "--out": OUT = argv[++i] ?? ""; break;
    case "--port": PORT = argv[++i] ?? ""; break;
    case "--install": INSTALL = true; break;
    case "--skip-stage": SKIP_STAGE = true; break;
    case "--allow-missing": ALLOW_MISSING = true; break;
    case "--brand": BRAND = argv[++i] ?? ""; if (!BRAND) die("--brand needs a value"); break;
    case "-h": case "--help": usage(); process.exit(0); break;
    default: usage(); die(`unknown option: ${argv[i]}`);
  }
}

MODE = MODE || kioskTerminalMode(KIOSK_DIR, KIOSK_PROFILE);
OUT = OUT || path.join(REPO_ROOT, "..", "build", "kiosk-studio", KIOSK.id);
const STUDIO_OUT = path.join(OUT, "studio");
const TEMPLATES = path.join(REPO_ROOT, "scripts", "bundle");
const STAGE = path.join(ELECTRON_DIR, "resources");

let RESOLVED;
try {
  RESOLVED = resolveDeployment([{ dir: KIOSK_DIR, mode: MODE }], { file: process.env.STUDIO_DEPLOYMENT_FILE, warn });
} catch (error) {
  die(error.message);
}
const DEPLOYMENT = structuredClone(RESOLVED.deployment);
const LLM_PRESET = DEPLOYMENT.services["text-generation"] ?? {};
LLM = LLM || (LLM_PRESET.status === "online" ? "local" : "remote");
if (LLM !== "local" && LLM !== "remote") die(`--llm takes remote or local, not "${LLM}"`);
DEPLOYMENT.services["text-generation"] = { ...LLM_PRESET, status: LLM === "local" ? "online" : "offline" };
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
'${MODE}' mode needs them. Check out the studio branch that provides them
(git -C "$EDGE_AI_STUDIO_DIR" branch -a), or pass --allow-missing to
knowingly build a reduced bundle without them.`);
  }
}

// The bundle ships the studio's whole service catalog, not just the kiosk's
// dependencies — the demo studio is meant to show every service it has. Samples
// are the opposite: the exporter keeps only the ones named by --samples, so the
// injected kiosk ends up as the gallery's single tile.
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
  if (!SERVICES.includes(s)) die(`${s} is not exportable but '${MODE}' mode needs it`);
}

info(`Embedded bundle: mode=${MODE}, LLM=${LLM}, kiosk port=${PORT}`);
info(`Exporting all ${SERVICES.length} studio services (kiosk needs: ${KIOSK_SERVICES.join(",")})`);
info(`Output: ${OUT}`);

// 1. Stage the kiosk's standalone server (server + assets + primed db + config)
if (SKIP_STAGE && fs.existsSync(path.join(STAGE, "server"))) {
  info(`Reusing existing kiosk stage (${STAGE})`);
  const stagedAt = fs.existsSync(path.join(STAGE, "config.yaml"))
    ? fs.statSync(path.join(STAGE, "config.yaml")).mtimeMs
    : 0;
  const newer = (entry) => {
    if (!fs.existsSync(entry)) return false;
    if (fs.statSync(entry).isFile()) return fs.statSync(entry).mtimeMs > stagedAt;
    return fs.readdirSync(entry).some((name) => newer(path.join(entry, name)));
  };
  if (stagedAt && (newer(path.join(FRONTEND_DIR, "src")) || newer(path.join(FRONTEND_DIR, "package.json")))) {
    warn("the reused stage is OLDER than the current frontend sources — a stale");
    warn("stage can crash the embedded kiosk (module mismatches); drop --skip-stage to rebuild it");
  }
} else {
  info(`Staging the kiosk server (electron stage, mode=${MODE}, live AI)`);
  runOk([process.execPath, path.join(ELECTRON_DIR, "scripts", "build.mjs"), "--stage-only", `--mode=${MODE}`, `--llm=${LLM}`, "--live"],
    { cwd: ELECTRON_DIR });
}
if (!fs.existsSync(path.join(STAGE, "server"))) die(`kiosk stage failed — ${path.join(STAGE, "server")} missing`);

// 2. Register the kiosk in the studio checkout, temporarily, so the studio's
// own samples-driven exporter can resolve it: `--samples=public-service-kiosk`
// makes the kiosk the only sample carried over, while `--services=…` asks for
// the full catalog. The exporter only copies git-visible files, so the injected
// files are made visible with `git add -N` (intent-to-add — nothing is staged
// or committed) and removed again right after the export, success or failure.
const INJECTED = [
  `frontend/src/services/${SAMPLE_ID}`,
  `frontend/src/samples/${SAMPLE_ID}`,
  `workers/${SAMPLE_ID}`,
];
const [SRC_SVC, SRC_SMP, SRC_WRK] = INJECTED.map((p) => path.join(EDGE_AI_STUDIO_DIR, ...p.split("/")));
for (const dir of [SRC_SVC, SRC_SMP, SRC_WRK]) {
  if (fs.existsSync(dir)) die(`${dir} already exists in the studio checkout — remove it first (a previous bundle run may have been interrupted)`);
}
if (git(["rev-parse", "--is-inside-work-tree"]).status !== 0) {
  die(`${EDGE_AI_STUDIO_DIR} is not a git checkout — the studio exporter needs one`);
}

function cleanupStudioInjection() {
  git(["reset", "-q", "--", ...INJECTED]);
  for (const dir of [SRC_SVC, SRC_SMP, SRC_WRK]) fs.rmSync(dir, { recursive: true, force: true });
}
const onSignal = () => { cleanupStudioInjection(); process.exit(130); };
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

const render = (template) =>
  fs.readFileSync(path.join(TEMPLATES, template), "utf8")
    .replaceAll("__KIOSK_PORT__", PORT)
    .replaceAll("public-service-kiosk", SAMPLE_ID)
    .replaceAll("Public Service Kiosk", SAMPLE_TITLE);

info("Registering the kiosk sample in the studio checkout (temporary, via git add -N)");
try {
  for (const dir of [SRC_SVC, SRC_SMP, SRC_WRK]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(SRC_SVC, "data.ts"), render("service-data.ts"));
  // Drop dependency lines for services this studio version doesn't have — the
  // exporter resolves deps from these literal lines and crashes on unknown ids.
  const sample = render("sample-data.ts").split("\n")
    .filter((line) => !MISSING_SERVICES.some((s) => line.includes(`serviceId: '${s}'`)))
    .join("\n");
  fs.writeFileSync(path.join(SRC_SMP, "data.ts"), sample);
  // The gallery tile's image: the first frame of docs/media/touch-kiosk-flow.gif.
  fs.copyFileSync(path.join(TEMPLATES, "sample-image.png"), path.join(SRC_SMP, "image.png"));
  // Both platforms' worker entry points, whichever platform builds the bundle:
  // the studio's process handler runs start.sh via bash on Linux and start.ps1
  // via powershell on Windows.
  fs.writeFileSync(path.join(SRC_WRK, "start.sh"), render("worker-start.sh"), { mode: 0o755 });
  fs.writeFileSync(path.join(SRC_WRK, "start.ps1"), render("worker-start.ps1"));
  if (git(["add", "-N", ...INJECTED]).status !== 0) die("git add -N failed in the studio checkout");

  // 3. Export the minimal studio (source tree; no Electron, no models)
  info("Exporting the studio: all services, kiosk sample only");
  fs.rmSync(STUDIO_OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  runOk([process.execPath, EXPORTER,
    `--samples=${SAMPLE_ID}`, `--services=${SERVICES.join(",")}`, `--out=${STUDIO_OUT}`],
    { cwd: EDGE_AI_STUDIO_DIR });
} finally {
  cleanupStudioInjection();
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
}

if (!fs.existsSync(path.join(STUDIO_OUT, "frontend", "src"))) die(`studio export failed — ${path.join(STUDIO_OUT, "frontend", "src")} missing`);
const EXPORTED_SAMPLE = path.join(STUDIO_OUT, "frontend", "src", "samples", SAMPLE_ID);
if (!fs.existsSync(path.join(EXPORTED_SAMPLE, "data.ts"))) die("export did not carry the kiosk sample — check the exporter output above");
if (!fs.existsSync(path.join(EXPORTED_SAMPLE, "image.png"))) die("export did not carry the kiosk sample image — the studio build needs it (data.ts imports it)");

// 3a. Drop the kiosk's server payload into the exported worker
info(`Copying the staged kiosk server into workers/${SAMPLE_ID}/bundle`);
const WORKER = path.join(STUDIO_OUT, "workers", SAMPLE_ID);
if (!fs.existsSync(path.join(WORKER, "start.sh"))) die(`export did not carry workers/${SAMPLE_ID}/start.sh`);
if (!fs.existsSync(path.join(WORKER, "start.ps1"))) die(`export did not carry workers/${SAMPLE_ID}/start.ps1`);
fs.chmodSync(path.join(WORKER, "start.sh"), 0o755);
fs.mkdirSync(path.join(WORKER, "bundle"), { recursive: true });
// verbatimSymlinks: the staged server's node_modules carry relative symlinks
// (see electron/scripts/build.mjs stage()) that must not be rewritten.
fs.cpSync(path.join(STAGE, "server"), path.join(WORKER, "bundle", "server"), { recursive: true, verbatimSymlinks: true });
fs.cpSync(path.join(STAGE, "assets"), path.join(WORKER, "bundle", "assets"), { recursive: true });
fs.cpSync(path.join(STAGE, "database"), path.join(WORKER, "bundle", "database"), { recursive: true });
fs.copyFileSync(path.join(STAGE, "config.yaml"), path.join(WORKER, "bundle", "config.yaml"));

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

// 4. Widen the generated registries' key types: the kiosk's id is not in the
// studio's baked Payload type union (the exporter already widens serviceMap;
// these two are the remaining union-typed spots in codegen).
const CODEGEN = path.join(STUDIO_OUT, "frontend", "scripts", "generate-registries.mjs");
fs.writeFileSync(CODEGEN, fs.readFileSync(CODEGEN, "utf8")
  .replace('Partial<Record<Service["type"], WorkerConfig>>', "Partial<Record<string, WorkerConfig>>")
  .replace('type: Service["type"],', "type: string,"));

// 5. Re-run codegen so the injected service + sample enter the registries
info("Regenerating studio registries");
runOk([process.execPath, path.join("scripts", "generate-registries.mjs")], { cwd: path.join(STUDIO_OUT, "frontend") });
const meta = fs.readFileSync(path.join(STUDIO_OUT, "frontend", "src", "services", "_generated", "meta.ts"), "utf8");
if (!meta.includes(SAMPLE_ID)) die("codegen did not pick up the kiosk service");
const samples = fs.readFileSync(path.join(STUDIO_OUT, "frontend", "src", "samples", "_generated", "samples.ts"), "utf8");
if (!samples.includes(SAMPLE_ID)) die("codegen did not pick up the kiosk sample");
const sampleCount = (samples.match(/^import \{ sample as/gm) || []).length;
if (sampleCount !== 1) die(`the exported gallery carries ${sampleCount} samples — expected only ${SAMPLE_ID}`);

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

// 7. Deployment presets: the mode's services + auto-start for the embedded kiosk.
// (The exporter does not carry deployment.json, so the bundle gets its own.)
info(`Writing bundle deployment.json (${KIOSK_FOLDER}/deployment.json '${MODE}' services + ${SAMPLE_ID} autostart)`);
DEPLOYMENT.services = Object.fromEntries(
  Object.entries(DEPLOYMENT.services).filter(([name]) => SERVICES.includes(name)),
);
DEPLOYMENT.services[SAMPLE_ID] = { status: "online" };
fs.writeFileSync(path.join(STUDIO_OUT, "deployment.json"), JSON.stringify(DEPLOYMENT, null, 2));

// The checkout gets the mode's services as the kiosk lists them (no LLM override, no kiosk autostart).
if (STUDIO_DEPLOYMENT_MANAGE === "1" && fs.existsSync(EDGE_AI_STUDIO_DIR)) {
  installDeployment(EDGE_AI_STUDIO_DIR, RESOLVED, { info, ok });
}

// 8. Bundle metadata + top-level README
fs.writeFileSync(path.join(OUT, "bundle.env"), `# Written by scripts/bundle.mjs — read by start.sh / start_win.bat --bundle
KIOSK_BUNDLE_MODE=${MODE}
KIOSK_BUNDLE_LLM=${LLM}
KIOSK_BUNDLE_PORT=${PORT}
KIOSK_BUNDLE_BRAND="${BRAND}"
`);
fs.writeFileSync(path.join(OUT, "README.md"), `# ${SAMPLE_TITLE} — ${BRAND} bundle

${BRAND} carrying the studio's full service catalog (${SERVICES.length} services),
with the ${SAMPLE_TITLE} as its only sample. The platform starts the kiosk
as a hidden worker process and auto-starts the kiosk plus the services its
'${MODE}' mode runs (${KIOSK_SERVICES.join(",")}) per \`studio/deployment.json\`; the rest
are exported but idle until started from the studio UI.

Built for kiosk mode: **${MODE}** · LLM: **${LLM === "local" ? "on this machine" : "remote (set llm.api_key at /settings)"}** · kiosk port: **${PORT}**

    cd studio
    sudo ./install_dependencies.sh   # once, system packages (Linux)
    ./setup.sh                       # once, runtimes + worker venvs + frontend build
    ./start.sh                       # studio gateway on :8080, kiosk on :${PORT}

On Windows, run \`setup_win.bat\` and \`start_win.bat\` instead (no
install_dependencies step). Or from the kiosk repo: \`${KIOSK_FOLDER}/scripts/start.sh --bundle\` /
\`${KIOSK_FOLDER}\\scripts\\start_win.bat --bundle\` (add \`--desktop\` for the desktop shell).
Kiosk UI: http://localhost:${PORT} · studio: http://localhost:8080
`);

ok(`Bundle staged at ${OUT}`);
const setupCmd = WINDOWS ? ["cmd.exe", "/c", "setup_win.bat"] : ["bash", "./setup.sh"];
if (INSTALL) {
  info("Running the bundle's setup (this installs worker environments and builds the frontend — long)");
  runOk(setupCmd, { cwd: STUDIO_OUT });
  ok(`Bundle is ready — start it with: ${WINDOWS ? `${KIOSK_FOLDER}\\scripts\\start_win.bat` : `${KIOSK_FOLDER}/scripts/start.sh`} --bundle`);
} else if (WINDOWS) {
  info(`Next: (cd ${STUDIO_OUT} && setup_win.bat) or ${KIOSK_FOLDER}\\scripts\\setup_win.bat --bundle, then ${KIOSK_FOLDER}\\scripts\\start_win.bat --bundle`);
} else {
  info(`Next: (cd ${STUDIO_OUT} && bash ./setup.sh) or ${KIOSK_FOLDER}/scripts/setup.sh --bundle, then ${KIOSK_FOLDER}/scripts/start.sh --bundle`);
}
