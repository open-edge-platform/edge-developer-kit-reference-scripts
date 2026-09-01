#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Build the kiosk into a single .AppImage / .exe.
 *
 * The kiosk is a Next.js server, so "one file" means three things have to end
 * up inside the bundle: the server compiled to a self-contained folder, a Node
 * runtime to run it, and the read-only assets it reads from disk. This script
 * assembles those into desktop/src-tauri and then calls `tauri build`.
 *
 * It asks first for the handful of settings that cannot be changed after the
 * fact. Next inlines every NEXT_PUBLIC_* value into the browser bundle at
 * build time, so which kiosk this terminal runs is decided here and nowhere
 * else — editing config.yaml on the installed machine cannot move it. The
 * answers are written into the config.yaml that ships with the app, so the
 * file on the terminal still reads as the truth about that install; every
 * other setting in it stays live and editable.
 *
 *   node scripts/build.mjs                    ask, then build
 *   node scripts/build.mjs --yes              take the defaults from config.yaml
 *   node scripts/build.mjs --mode=touch --fullscreen --targets=appimage,deb
 *   node scripts/build.mjs --stage-only       assemble, don't call tauri
 *   node scripts/build.mjs --no-build         reuse the last kiosk server build
 *   node scripts/build.mjs --dev              assemble, then `tauri dev`
 *   node scripts/build.mjs --shell-only       compile just the shell binary —
 *                                             for external-target mode, where
 *                                             the embedded bundle is the payload
 *   node scripts/build.mjs --bundle-app       package the embedded bundle
 *                                             (build/kiosk-studio) as the app:
 *                                             it ships as one tar, unpacked and
 *                                             set up on the target's first launch
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const TAURI_APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(TAURI_APP, "..");
const FRONTEND = path.join(ROOT, "frontend");
const CRATE = path.join(TAURI_APP, "src-tauri");
const STAGE = path.join(CRATE, "resources");
const SERVER = path.join(STAGE, "server");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const TERMINAL_MODES = {
  touch: "Touch — the guided tap-through flow",
  chat: "Chat — the assistant, driven by the flow engine",
  agent: "Agent — the assistant, driven by a tool-calling model over MCP",
};

const step = (message) => console.log(`\n\x1b[1;36m▸ ${message}\x1b[0m`);
const note = (message) => console.log(`  \x1b[2m${message}\x1b[0m`);

async function main() {
  if (flag("shell-only")) {
    await requireRust();
    step("Building the desktop shell binary");
    await run("cargo", ["build", "--release"], CRATE);
    note(`binary: ${path.join(CRATE, "target", "release", "kiosk-desktop")}`);
    return;
  }

  if (flag("bundle-app")) {
    await bundleApp();
    return;
  }

  if (!existsSync(FRONTEND)) fail(`no frontend/ next to ${TAURI_APP}`);
  await ensureDependencies();
  await ensureFrontendDependencies();

  const config = await fs.readFile(path.join(FRONTEND, "config.yaml"), "utf8");
  const answers = await ask(config);

  if (flag("no-build")) {
    step("Reusing the last kiosk server build");
    note("the answers above only reach the browser through a real build");
  } else {
    step("Building the kiosk server");
    await buildNextServer(answers);
  }

  step("Assembling the bundle");
  const shipped = applyAnswers(config, answers);
  await stage(shipped, answers.mock);
  await primeDatabase();
  await bundleNode();

  step("Preparing the shell");
  await run(process.execPath, [path.join(TAURI_APP, "scripts", "make-icons.mjs")], TAURI_APP);
  const overlay = await writeTauriConfig(answers, {
    resources: [
      "resources/server",
      "resources/assets",
      "resources/database",
      "resources/config.yaml",
    ],
    externalBin: ["binaries/node"],
  });

  if (flag("stage-only")) {
    step("Staged");
    note(`everything is under ${path.relative(ROOT, STAGE)} — run \`npm run build\` to package it`);
    return;
  }

  await packageShell(overlay, answers.targets, flag("dev"));
}

async function packageShell(overlay, targets, dev) {
  await requireRust();
  step(dev ? "Starting the shell" : `Packaging (${targets.join(", ")})`);
  // Extract-and-run unpacks to $TMPDIR/appimage_extracted_<md5 of the tool's
  // path> — the same directory every run, so two builds on one machine delete
  // it out from under each other mid-bundle ("linuxdeploy (deleted)"). A
  // per-run TMPDIR keeps them apart.
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "kiosk-tauri-"));
  try {
    await run(
      npx(),
      dev ? ["tauri", "dev", "--config", overlay] : ["tauri", "build", "--config", overlay],
      TAURI_APP,
      {
        // linuxdeploy ships as an AppImage itself, and mounting one needs FUSE2
        // (libfuse.so.2) — absent by default on Ubuntu 24.04+, which only ships
        // FUSE3. This makes it extract itself and run instead of mounting, so
        // packaging works whether or not FUSE2 is installed. No effect outside
        // the appimage target.
        APPIMAGE_EXTRACT_AND_RUN: "1",
        TMPDIR: scratch,
      },
    );
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }

  if (!dev) {
    const out = path.join(CRATE, "target", "release", "bundle");
    const dist = path.join(ROOT, "build");
    await fs.mkdir(dist, { recursive: true });
    // Earlier builds' packages stay in build/ (same name = replaced); only
    // the formats built THIS run are copied — the target directory can hold
    // stale files from previous target choices.
    const extFor = { appimage: "AppImage", deb: "deb", rpm: "rpm", nsis: "exe", msi: "msi" };
    const wanted = new Set(targets.map((t) => extFor[t]).filter(Boolean));
    // The target directory also holds artifacts from before a product rename.
    const { productName } = JSON.parse(
      await fs.readFile(path.join(CRATE, "tauri.conf.json"), "utf8"),
    );
    step("Done");
    for (const file of await findBundles(out)) {
      const name = path.basename(file);
      if (!wanted.has(name.split(".").pop())) continue;
      if (productName && !name.startsWith(productName)) continue;
      const copy = path.join(dist, path.basename(file));
      await fs.copyFile(file, copy);
      // fs.copyFile leaves the mode to the umask, and an AppImage is only an
      // AppImage while it is executable.
      await fs.chmod(copy, (await fs.stat(file)).mode);
      note(path.relative(ROOT, copy));
    }
  }
}

/* -- the embedded bundle as the app --------------------------------------- */

/**
 * Package build/kiosk-studio — the minimal, pre-setup studio export with the
 * kiosk injected — as the desktop app. The export ships inside the package as
 * a single tar: a tar survives what plain resource copying does not (the
 * symlinked Node runtime, execute bits, linuxdeploy's ldd sweep), and the
 * install is read-only anyway. The shell unpacks it into the data directory
 * on first launch, runs the studio's setup there, and starts the platform
 * (see src-tauri/src/main.rs).
 */
async function bundleApp() {
  // Questions first: everything after this line is minutes of unattended work
  // (installs, the frontend build, the studio export, the Rust build).
  const answers = await askBundleApp();

  // Fresh export every build — scripts/bundle.sh installs what is missing,
  // builds the kiosk server and re-exports the minimal studio, so packaging
  // never picks up a stale or set-up-in-place tree. Shell flags stay here;
  // everything else is bundle.sh's.
  const shellFlags = ["--bundle-app", "--yes", "--fullscreen", "--windowed"];
  const bundleArgs = argv.filter(
    (arg) => !shellFlags.includes(arg) && !arg.startsWith("--targets="),
  );
  // The chosen mode decides what bundle.sh exports (services, deployment
  // profile) and which kiosk the frontend build bakes in; a --mode already on
  // the command line is what the question defaulted to, so it is not repeated.
  if (!bundleArgs.some((arg) => arg === "--mode" || arg.startsWith("--mode="))) {
    bundleArgs.push("--mode", answers.mode);
  }
  await run("bash", [path.join(ROOT, "scripts", "bundle.sh"), ...bundleArgs], ROOT);

  const bundleOut = process.env.KIOSK_BUNDLE_DIR || path.join(ROOT, "build", "kiosk-studio");
  const studio = path.join(bundleOut, "studio");
  if (!existsSync(path.join(studio, "setup.sh"))) {
    fail(`the export left no bundle at ${bundleOut} — check the bundle.sh output above`);
  }
  // The package must carry the minimal export — the worker environments are
  // created on the installed machine, where their absolute paths are right.
  if (existsSync(path.join(studio, "frontend", "node_modules"))) {
    fail(
      `the bundle at ${bundleOut} has been set up in place.\n` +
        `  Re-run scripts/bundle.sh for a fresh minimal export before packaging.`,
    );
  }

  await ensureDependencies();

  step("Staging the embedded bundle");
  await fs.rm(STAGE, { recursive: true, force: true });
  await fs.mkdir(STAGE, { recursive: true });
  // thirdparty/ (Node, ffmpeg) is only a pre-seed for the from-checkout flow:
  // the studio's setup_thirdparty.sh downloads both when missing, and the
  // package's first launch runs setup anyway — shipping them would add
  // ~450 MB the target can fetch itself.
  await run(
    "tar",
    [
      "-C", bundleOut,
      "--exclude=studio/thirdparty",
      "--exclude=studio/logs",
      "-cf", path.join(STAGE, "kiosk-studio.tar"),
      "studio",
    ],
    ROOT,
  );
  note(`${await du(STAGE)} staged in ${path.relative(ROOT, STAGE)}`);

  step("Preparing the shell");
  await run(process.execPath, [path.join(TAURI_APP, "scripts", "make-icons.mjs")], TAURI_APP);
  // No externalBin here: that Node runtime is for the standalone kiosk's
  // kiosk.cjs — the studio brings its own (thirdparty/node) and the shell
  // never spawns node itself.
  const overlay = await writeTauriConfig(answers, {
    resources: ["resources/kiosk-studio.tar"],
  });

  await packageShell(overlay, answers.targets, false);
  note("install on the terminal — first launch unpacks the platform, runs its");
  note("setup (downloads), then starts the studio with the kiosk as its worker");
}

/**
 * The mode decides more here than which kiosk the terminal runs: it picks the
 * AI services the bundle carries and the deployment profile the platform
 * starts them with, so it is asked before anything is exported.
 */
async function askBundleApp() {
  const config = await fs.readFile(path.join(FRONTEND, "config.yaml"), "utf8");
  const answers = {
    mode: option("mode") ?? argModeValue() ?? readYaml(config, "terminal", "mode") ?? "chat",
    fullscreen: flag("fullscreen") ? true : flag("windowed") ? false : true,
    targets: (option("targets") ?? defaultTargets()).split(",").map((t) => t.trim()),
  };

  if (flag("yes") || !process.stdin.isTTY) {
    describeBundleApp(answers);
    return answers;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\n\x1b[1mKiosk install settings\x1b[0m");
    note("baked into this build — the platform's services follow the mode\n");

    answers.mode = await choose(rl, "Which kiosk does this terminal run?",
      Object.entries(TERMINAL_MODES).map(([value, label]) => ({ value, label })), answers.mode);

    answers.fullscreen = await confirm(rl,
      "Run fullscreen with no window chrome (kiosk mode)?", answers.fullscreen);

    answers.targets = await choose(rl, "What should be packaged?",
      packagingChoices(), answers.targets.join(","))
      .then((value) => value.split(","));
  } finally {
    rl.close();
  }

  describeBundleApp(answers);
  return answers;
}

/** `--mode touch`, the spaced form scripts/bundle.sh takes. */
function argModeValue() {
  const at = argv.indexOf("--mode");
  return at === -1 ? undefined : argv[at + 1];
}

function describeBundleApp(answers) {
  console.log("");
  note(`kiosk        ${answers.mode}`);
  note(`services     ${MODE_SERVICES[answers.mode] ?? "?"}`);
  note(`window       ${answers.fullscreen ? "fullscreen" : "windowed"}`);
  note(`package      ${answers.targets.join(", ")}`);
}

/** Mirrors the mode → services mapping in scripts/bundle.sh. */
const MODE_SERVICES = {
  touch: "LLM (GPU), OCR (NPU), face (CPU)",
  chat: "LLM (GPU), OCR, face, speech-to-text, text-to-speech (CPU)",
  agent: "LLM (GPU), OCR, face, speech-to-text, text-to-speech (CPU)",
};

/* -- questions ------------------------------------------------------------ */

/**
 * Only the settings that the build bakes in are worth asking about. Anything
 * the server reads at run time — the AI service URLs, timings, the scanner —
 * stays in config.yaml on the terminal, where it can be changed without a
 * rebuild.
 */
async function ask(config) {
  const defaults = {
    mode: readYaml(config, "terminal", "mode") ?? "touch",
    mock: readYaml(config, "llm", "mock") === "true",
  };

  const answers = {
    mode: option("mode") ?? defaults.mode,
    mock: flag("mock") ? true : flag("live") ? false : defaults.mock,
    fullscreen: flag("fullscreen") ? true : flag("windowed") ? false : true,
    targets: (option("targets") ?? defaultTargets()).split(",").map((t) => t.trim()),
  };

  const interactive = !flag("yes") && !flag("stage-only") && process.stdin.isTTY;
  if (!interactive) {
    describe(answers);
    return answers;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\n\x1b[1mKiosk install settings\x1b[0m");
    note("baked into this build — everything else stays editable in config.yaml\n");

    answers.mode = await choose(rl, "Which kiosk does this terminal run?",
      Object.entries(TERMINAL_MODES).map(([value, label]) => ({ value, label })), answers.mode);

    answers.fullscreen = await confirm(rl,
      "Run fullscreen with no window chrome (kiosk mode)?", answers.fullscreen);

    answers.mock = await confirm(rl,
      "Mock the AI services (no Edge AI Demo Studio on the terminal)?", answers.mock);

    answers.targets = await choose(rl, "What should be packaged?",
      packagingChoices(), answers.targets.join(","))
      .then((value) => value.split(","));
  } finally {
    rl.close();
  }

  describe(answers);
  return answers;
}

function describe(answers) {
  console.log("");
  note(`kiosk        ${answers.mode}`);
  note(`window       ${answers.fullscreen ? "fullscreen" : "windowed"}`);
  note(`AI services  ${answers.mock ? "mocked" : "live (config.yaml decides the URLs)"}`);
  note(`package      ${answers.targets.join(", ")}`);
}

function defaultTargets() {
  return process.platform === "win32" ? "nsis" : "appimage";
}

function packagingChoices() {
  return process.platform === "win32"
    ? [
        { value: "nsis", label: "Installer .exe (NSIS)" },
        { value: "msi", label: "Installer .msi" },
        { value: "nsis,msi", label: "Both" },
      ]
    : [
        { value: "appimage", label: ".AppImage — one file, runs anywhere" },
        { value: "deb", label: ".deb — installs through apt" },
        { value: "appimage,deb", label: "Both" },
      ];
}

async function choose(rl, question, choices, fallback) {
  console.log(`\n${question}`);
  choices.forEach((choice, index) => {
    const marker = choice.value === fallback ? "\x1b[32m•\x1b[0m" : " ";
    console.log(`  ${marker} ${index + 1}) ${choice.label}`);
  });
  const answer = (await rl.question(`  [${fallback}] `)).trim();
  if (!answer) return fallback;
  const byIndex = choices[Number(answer) - 1];
  if (byIndex) return byIndex.value;
  if (choices.some((choice) => choice.value === answer)) return answer;
  console.log("  \x1b[33mnot one of the choices — keeping the default\x1b[0m");
  return fallback;
}

async function confirm(rl, question, fallback) {
  const answer = (await rl.question(`\n${question} ${fallback ? "[Y/n]" : "[y/N]"} `)).trim();
  if (!answer) return fallback;
  return /^y/i.test(answer);
}

/* -- the kiosk server ----------------------------------------------------- */

/**
 * `output: "standalone"` (see frontend/next.config.ts) writes a folder that
 * carries its own node_modules, so the bundle never needs an npm install on
 * the terminal. Next leaves two things out of it deliberately, because a
 * deployment normally serves them from a CDN — copy them in.
 */
async function buildNextServer(answers) {
  await run("npm", ["run", "build"], FRONTEND, {
    KIOSK_STANDALONE: "1",
    // Real environment beats config.yaml (see frontend/src/lib/kiosk-config.ts),
    // which is how the answers reach the client bundle Next is inlining now.
    NEXT_PUBLIC_KIOSK_MODE: answers.mode,
    KIOSK_LLM_MOCK: String(answers.mock),
  });

  requireStandalone();
}

function requireStandalone() {
  if (existsSync(path.join(FRONTEND, ".next", "standalone"))) return;
  fail(
    "there is no frontend/.next/standalone to bundle.\n" +
      "  Run without --no-build, or build it by hand:\n" +
      "    cd frontend && KIOSK_STANDALONE=1 npm run build",
  );
}

/** Runtime state and test scaffolding that the tracer sweeps up regardless. */
const NOT_SHIPPED = new Set([
  "db.sqlite", "db.sqlite-shm", "db.sqlite-wal", "face-photos", "tests",
  "test-results", "playwright-report", "tsconfig.tsbuildinfo", ".env.local.bak",
]);

async function stage(shippedConfig, mock) {
  requireStandalone();
  await fs.rm(STAGE, { recursive: true, force: true });
  await fs.mkdir(STAGE, { recursive: true });

  await fs.cp(path.join(FRONTEND, ".next", "standalone"), SERVER, {
    recursive: true,
    filter: (src) => !NOT_SHIPPED.has(path.basename(src)),
  });

  const pruned = await pruneMuslNativeModules(path.join(SERVER, "node_modules"));
  if (pruned.length) note(`pruned musl native module(s): ${pruned.join(", ")}`);

  await fs.cp(
    path.join(FRONTEND, ".next", "static"),
    path.join(SERVER, ".next", "static"),
    { recursive: true },
  );
  if (existsSync(path.join(FRONTEND, "public"))) {
    await fs.cp(path.join(FRONTEND, "public"), path.join(SERVER, "public"), { recursive: true });
  }

  // config.yaml resolves documents.mocks_dir and friends against the server's
  // working directory, so assets/ has to keep sitting beside it. The mock
  // documents themselves only ship in a mocked build — and one citizen's set
  // (the generator's default) is enough there. A live build stages the empty
  // directory: the path is declared as a bundle resource, but nothing in a
  // live terminal reads the generated files.
  const assetsStage = path.join(STAGE, "assets");
  if (mock) {
    await run(process.execPath, [path.join(FRONTEND, "scripts", "gen-mock-docs.mjs")], FRONTEND);
    await fs.cp(path.join(ROOT, "assets"), assetsStage, {
      recursive: true,
      // Written to at run time; the app writes into its data directory instead.
      filter: (src) => !["pdf", "scanner"].includes(path.relative(path.join(ROOT, "assets"), src)),
    });
  } else {
    await fs.mkdir(assetsStage, { recursive: true });
  }

  await fs.writeFile(path.join(STAGE, "config.yaml"), shippedConfig);
  await writeServerEntry();

  const size = await du(STAGE);
  note(`${size} staged in ${path.relative(ROOT, STAGE)}`);
}

/**
 * Native addons (pcsc-mini, sharp, libsql) publish both a glibc and a musl
 * build as optional dependencies, and npm's libc filtering doesn't reliably
 * skip the one this machine can't use — so both end up in the standalone
 * tracer's output. That's harmless until packaging: the appimage bundler
 * shells out to `ldd` on every binary it deploys, and `ldd` hard-crashes on
 * a musl .node file under glibc, taking the whole build down with it. This
 * build never targets musl, so those variants are dropped before bundling.
 */
async function pruneMuslNativeModules(nodeModules) {
  const removed = [];
  for (const scope of await fs.readdir(nodeModules).catch(() => [])) {
    const scopeDir = path.join(nodeModules, scope);
    if (!scope.startsWith("@")) {
      if (scope.includes("musl")) {
        await fs.rm(scopeDir, { recursive: true, force: true });
        removed.push(scope);
      }
      continue;
    }
    for (const pkg of await fs.readdir(scopeDir).catch(() => [])) {
      if (!pkg.includes("musl")) continue;
      await fs.rm(path.join(scopeDir, pkg), { recursive: true, force: true });
      removed.push(`${scope}/${pkg}`);
    }
  }
  return removed;
}

/**
 * The kiosk reads config.yaml relative to the working directory, and Next's
 * standalone server chdir's into its own folder — which is read-only once
 * bundled. So the settings are read first, from the writable data directory,
 * by this wrapper.
 *
 * applyKioskConfig() memoises itself on a global symbol and never overwrites a
 * variable the environment already set. That is what makes this enough: the
 * app's own call, later and from the wrong directory, finds the work done.
 */
async function writeServerEntry() {
  const esbuild = await import("esbuild");
  await esbuild.build({
    entryPoints: [path.join(FRONTEND, "src", "lib", "kiosk-config.ts")],
    outfile: path.join(SERVER, "kiosk-config.cjs"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    logLevel: "warning",
  });

  await fs.writeFile(
    path.join(SERVER, "kiosk.cjs"),
    `// Generated by tauri/scripts/build.mjs — do not edit.\n` +
      `// Reads <data dir>/config.yaml into the environment, then hands over to\n` +
      `// the standalone Next server. See writeServerEntry() for why.\n` +
      `require("./kiosk-config.cjs").applyKioskConfig(\n` +
      `  process.env.KIOSK_DATA_DIR || __dirname,\n` +
      `);\n` +
      `require("./server.js");\n`,
  );
}

/**
 * Create the database the app ships with.
 *
 * Payload builds its tables on connect, but only when NODE_ENV is not
 * "production" — the production path expects migrations to have been written,
 * and this project has none: the database is disposable and reseeds itself
 * (see frontend/src/payload/seed.ts). A packaged kiosk is production by
 * definition, so the tables are made here instead, once, and the result is
 * shipped as the file a fresh install starts from.
 *
 * Payload is started on its own rather than through the server, because Next
 * replaces `process.env.NODE_ENV` with a literal when it compiles: inside the
 * built server the check is decided and nothing at run time can reopen it.
 */
async function primeDatabase() {
  const template = path.join(STAGE, "database");
  const faces = path.join(template, "face-photos");
  await fs.mkdir(faces, { recursive: true });

  // Under .next so it resolves the kiosk's own node_modules — payload, sharp
  // and the SQLite driver are left as imports rather than bundled.
  const scratch = path.join(FRONTEND, ".next", "kiosk-prime");
  await fs.mkdir(scratch, { recursive: true });

  const esbuild = await import("esbuild");
  await esbuild.build({
    entryPoints: [path.join(FRONTEND, "src", "payload", "payload.config.ts")],
    outfile: path.join(scratch, "payload.config.mjs"),
    tsconfig: path.join(FRONTEND, "tsconfig.json"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    packages: "external",
    logLevel: "warning",
  });

  await fs.writeFile(
    path.join(scratch, "prime.mjs"),
    `// Written and deleted by tauri/scripts/build.mjs. Not part of the bundle.\n` +
      `import { getPayload } from "payload";\n` +
      `import config from "./payload.config.mjs";\n` +
      `// Connecting is the whole job: it creates the tables, and the config's\n` +
      `// onInit seeds them.\n` +
      `await getPayload({ config });\n` +
      `process.exit(0);\n`,
  );

  try {
    await run(process.execPath, [path.join(scratch, "prime.mjs")], FRONTEND, {
      NODE_ENV: "development",
      DATABASE_URL: `file:${path.join(template, "db.sqlite")}`,
      KIOSK_FACE_PHOTOS_DIR: faces,
    });
  } catch (error) {
    fail(`could not prepare the database: ${error.message}`);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }

  const portraits = (await fs.readdir(faces)).length;
  note(`database prepared (${portraits} reference portrait${portraits === 1 ? "" : "s"})`);
}

/**
 * Ship the Node runtime beside the app. Tauri copies an `externalBin` next to
 * the executable and keeps its execute bit, which a plain resource loses.
 */
async function bundleNode() {
  const triple = await hostTriple();
  const source = option("node") ?? process.execPath;
  const target = path.join(CRATE, "binaries", `node-${triple}${process.platform === "win32" ? ".exe" : ""}`);

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  await fs.chmod(target, 0o755);
  note(`node ${process.version} bundled as ${path.basename(target)}`);
}

/* -- config.yaml ---------------------------------------------------------- */

/**
 * Read a `key:` from one top-level section, commented out or not. Deliberately
 * line-based: config.yaml is mostly documentation, and it has to survive this
 * with every comment in place.
 */
function yamlEntry(line) {
  const body = line.trimStart();
  const bare = body.startsWith("#") ? body.slice(1).trimStart() : body;
  const colon = bare.indexOf(":");
  if (colon < 0) return undefined;
  return {
    indent: line.slice(0, line.length - body.length),
    key: bare.slice(0, colon),
    after: bare.slice(colon + 1),
  };
}

function readYaml(config, section, key) {
  const lines = config.split("\n");
  let inside = false;
  for (const line of lines) {
    if (/^\S/.test(line)) inside = line.startsWith(`${section}:`);
    else if (inside) {
      const entry = yamlEntry(line);
      if (!entry) continue;
      if (entry.key === key) return entry.after.trim() || undefined;
    }
  }
  return undefined;
}

function writeYaml(config, section, key, value) {
  const lines = config.split("\n");
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) {
      if (inside) break;
      inside = lines[i].startsWith(`${section}:`);
      continue;
    }
    if (!inside) continue;
    const entry = yamlEntry(lines[i]);
    if (!entry) continue;
    if (entry.key === key && /^\s/.test(entry.after)) {
      lines[i] = `${entry.indent}${key}: ${value}`;
      return lines.join("\n");
    }
  }
  fail(`config.yaml has no ${section}.${key} to set`);
}

const HEADER = (answers) =>
  `# Kiosk settings for this terminal.\n` +
  `#\n` +
  `# Edit and restart the app — every setting below is read on each start,\n` +
  `# except the two the build had to bake into the browser bundle:\n` +
  `#\n` +
  `#   terminal.mode   ${answers.mode}\n` +
  `#   documents.source\n` +
  `#\n` +
  `# Changing either of those means rebuilding the app (tauri/scripts/build.mjs).\n` +
  `# Paths are resolved against the bundled server, so the read-only ones (the\n` +
  `# mock documents, the seed data) already point where they should. The\n` +
  `# database, captured documents and portraits live beside this file and are\n` +
  `# set by the app, whatever documents.uploads_dir and cms.database_url say.\n` +
  `\n`;

function applyAnswers(config, answers) {
  let out = writeYaml(config, "terminal", "mode", answers.mode);
  out = writeYaml(out, "llm", "mock", String(answers.mock));
  return HEADER(answers) + out;
}

/* -- the shell ------------------------------------------------------------ */

/**
 * The committed tauri.conf.json is the shape of the app; the answers go in an
 * overlay so a build never leaves the repository dirty. The base config also
 * carries no `resources`/`externalBin`: tauri's build.rs validates those paths
 * at compile time, so each flow declares its own set here — a bare
 * `cargo build` (e.g. --shell-only on a clean checkout) then needs no staged
 * files at all.
 */
async function writeTauriConfig(answers, extraBundle = {}) {
  const base = JSON.parse(await fs.readFile(path.join(CRATE, "tauri.conf.json"), "utf8"));
  const overlay = {
    app: {
      // Tauri replaces arrays rather than merging them, so this is the whole
      // window, not the one field that changed.
      windows: [{
        ...base.app.windows[0],
        fullscreen: answers.fullscreen,
        decorations: !answers.fullscreen,
      }],
    },
    bundle: { targets: answers.targets, ...extraBundle },
  };

  const file = path.join(CRATE, "tauri.build.conf.json");
  await fs.writeFile(file, `${JSON.stringify(overlay, null, 2)}\n`);
  return file;
}

/* -- plumbing ------------------------------------------------------------- */

function npx() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function run(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, ...env },
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)),
    );
  });
}

function capture(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", () => resolve(null));
    child.on("exit", (code) => resolve(code === 0 ? out : null));
  });
}

async function hostTriple() {
  const version = await capture("rustc", ["-vV"]);
  const match = version?.match(/^host:\s*(\S+)$/m);
  if (match) return match[1];
  // Only reached before Rust is installed, and requireRust() stops the build
  // before the name matters.
  return process.platform === "win32" ? "x86_64-pc-windows-msvc" : "x86_64-unknown-linux-gnu";
}

async function requireRust() {
  if (await capture("cargo", ["--version"])) return;
  fail(
    "cargo is not on PATH — Tauri needs the Rust toolchain.\n" +
      "  Run tauri/scripts/setup-linux.sh (Ubuntu) or see https://tauri.app/start/prerequisites/",
  );
}

async function ensureDependencies() {
  const present = (pkg) => existsSync(path.join(TAURI_APP, "node_modules", pkg));
  if (present("esbuild") && present("@tauri-apps/cli")) return;
  step("Installing the shell's build dependencies");
  await run("npm", ["install"], TAURI_APP);
}

/**
 * The kiosk build (next build, payload priming, the mock generator) runs out
 * of frontend/node_modules — a cleaned checkout has none, and a partial
 * install has bitten before (yaml present in the lockfile, absent on disk),
 * so key packages are checked, not just the directory.
 */
async function ensureFrontendDependencies() {
  const present = (pkg) => existsSync(path.join(FRONTEND, "node_modules", pkg));
  if (present("next") && present("yaml") && present("payload")) return;
  step("Installing the kiosk's dependencies (frontend/)");
  await run("npm", ["install"], FRONTEND);
}

async function du(dir) {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += (await fs.stat(path.join(entry.parentPath, entry.name))).size;
  }
  return `${(total / 1024 ** 2).toFixed(0)} MB`;
}

async function findBundles(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && /\.(AppImage|deb|rpm|exe|msi)$/.test(entry.name)) {
      found.push(path.join(entry.parentPath, entry.name));
    }
  }
  return found;
}

function fail(message) {
  console.error(`\n\x1b[31m✗ ${message}\x1b[0m\n`);
  process.exit(1);
}

await main();
