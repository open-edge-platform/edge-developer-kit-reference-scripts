#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Build the kiosk into a single .AppImage / .exe.
 *
 * The kiosk is a Next.js server, so "one file" means two things have to end
 * up inside the bundle: the server compiled to a self-contained folder and
 * the read-only assets it reads from disk — the shell runs the server on
 * Electron's own Node, so no second runtime ships. This script assembles
 * those into electron/resources and then calls `electron-builder`.
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
 *   node scripts/build.mjs --stage-only       assemble, don't package
 *   node scripts/build.mjs --no-build         reuse the last kiosk server build
 *   node scripts/build.mjs --dev              assemble, then `electron .`
 *   node scripts/build.mjs --shell-only       package just the shell, unpacked —
 *                                             for external-target mode, where
 *                                             the embedded bundle is the payload
 *   node scripts/build.mjs --bundle-app       package the embedded bundle
 *                                             (build/kiosk-studio) as the app:
 *                                             it ships as one tar, unpacked and
 *                                             set up on the target's first launch
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const SHELL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(SHELL, "..");
const FRONTEND = path.join(ROOT, "frontend");
const STAGE = path.join(SHELL, "resources");
const SERVER = path.join(STAGE, "server");
const OUT = path.join(SHELL, "out");

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
    await ensureDependencies();
    step("Packaging the desktop shell, unpacked");
    await run(process.execPath, [path.join(SHELL, "scripts", "make-icons.mjs")], SHELL);
    const config = await writeShellConfig({ fullscreen: false }, { resources: false });
    await run(npx(), ["electron-builder", "--dir", "--config", config], SHELL);
    note(`shell: ${path.join(OUT, unpackedDir(), "kiosk-desktop")}`);
    return;
  }

  if (flag("bundle-app")) {
    await bundleApp();
    return;
  }

  if (!existsSync(FRONTEND)) fail(`no frontend/ next to ${SHELL}`);
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

  step("Preparing the shell");
  await run(process.execPath, [path.join(SHELL, "scripts", "make-icons.mjs")], SHELL);
  const overlay = await writeShellConfig(answers, { resources: true });

  if (flag("stage-only")) {
    step("Staged");
    note(`everything is under ${path.relative(ROOT, STAGE)} — run \`npm run build\` to package it`);
    return;
  }

  await packageShell(overlay, answers.targets, flag("dev"));
}

async function packageShell(overlay, targets, dev) {
  step(dev ? "Starting the shell" : `Packaging (${targets.join(", ")})`);
  if (dev) {
    await run(npx(), ["electron", "."], SHELL);
    return;
  }

  // A fresh out/ per build: electron-builder leaves every earlier artifact in
  // place, and the copy below must only see the formats built THIS run.
  await fs.rm(OUT, { recursive: true, force: true });
  await run(npx(), ["electron-builder", "--config", overlay], SHELL);

  const dist = path.join(ROOT, "build");
  await fs.mkdir(dist, { recursive: true });
  step("Done");
  for (const file of await findBundles(OUT)) {
    const copy = path.join(dist, path.basename(file));
    await fs.copyFile(file, copy);
    // fs.copyFile leaves the mode to the umask, and an AppImage is only an
    // AppImage while it is executable.
    await fs.chmod(copy, (await fs.stat(file)).mode);
    note(path.relative(ROOT, copy));
  }
}

/** electron-builder's unpacked output directory for this platform. */
function unpackedDir() {
  return process.platform === "win32" ? "win-unpacked" : "linux-unpacked";
}

/* -- the embedded bundle as the app --------------------------------------- */

/**
 * Package build/kiosk-studio — the minimal, pre-setup studio export with the
 * kiosk injected — as the desktop app. The export ships inside the package as
 * a single tar: a tar survives what plain resource copying does not (the
 * symlinked Node runtime, execute bits), and the install is read-only anyway.
 * The shell unpacks it into the data directory on first launch, runs the
 * studio's setup there, and starts the platform (see main.js).
 */
async function bundleApp() {
  // Questions first: everything after this line is minutes of unattended work
  // (installs, the frontend build, the studio export).
  const answers = await askBundleApp();

  // Fresh export every build — scripts/bundle.mjs installs what is missing,
  // builds the kiosk server and re-exports the minimal studio, so packaging
  // never picks up a stale or set-up-in-place tree. Shell flags stay here;
  // everything else is bundle.mjs's.
  const shellFlags = ["--bundle-app", "--yes", "--fullscreen", "--windowed"];
  const bundleArgs = argv.filter(
    (arg) => !shellFlags.includes(arg) && !arg.startsWith("--targets="),
  );
  // The chosen mode decides what bundle.mjs exports (services, deployment
  // profile) and which kiosk the frontend build bakes in; a --mode already on
  // the command line is what the question defaulted to, so it is not repeated.
  if (!bundleArgs.some((arg) => arg === "--mode" || arg.startsWith("--mode="))) {
    bundleArgs.push("--mode", answers.mode);
  }
  await run(process.execPath, [path.join(ROOT, "scripts", "bundle.mjs"), ...bundleArgs], ROOT);

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
  await run(process.execPath, [path.join(SHELL, "scripts", "make-icons.mjs")], SHELL);
  const overlay = await writeShellConfig(answers, { resources: true });

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

  // Turbopack points every serverExternalPackage at a relative symlink under
  // .next/node_modules (pdfkit -> ../../node_modules/pdfkit). fs.cp rewrites
  // relative symlinks into absolute ones against the SOURCE tree unless
  // verbatimSymlinks is set — which bakes this checkout's path into the
  // package and leaves them dangling on any other machine. Windows needs the
  // real files instead: creating a symlink there needs Developer Mode or an
  // elevated process, neither of which a build should require.
  await fs.cp(path.join(FRONTEND, ".next", "standalone"), SERVER, {
    recursive: true,
    verbatimSymlinks: process.platform !== "win32",
    dereference: process.platform === "win32",
    filter: (src) => !NOT_SHIPPED.has(path.basename(src)),
  });

  const pruned = await pruneMuslNativeModules(path.join(SERVER, "node_modules"));
  if (pruned.length) note(`pruned musl native module(s): ${pruned.join(", ")}`);

  const restored = await restoreLibvips(path.join(SERVER, "node_modules"));
  if (restored.length) note(`restored libvips runtime: ${restored.join(", ")}`);

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
 * a musl .node file under glibc — and either way this build never targets
 * musl, so those variants are dead weight and are dropped before bundling.
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
 * sharp reaches libvips through its prebuilt .node's RPATH
 * ($ORIGIN/../../sharp-libvips-linux-x64/lib), not through a require() — so
 * Next's output tracer, which only walks the JS graph, carries that package's
 * index.js and leaves the shared library itself behind. Nothing notices until
 * the packaged kiosk starts and every image route dies on a missing
 * libvips-cpp.so, so the traced copy is replaced with the whole package.
 */
async function restoreLibvips(nodeModules) {
  const staged = path.join(nodeModules, "@img");
  const source = path.join(FRONTEND, "node_modules", "@img");
  const restored = [];
  for (const pkg of await fs.readdir(staged).catch(() => [])) {
    if (!pkg.startsWith("sharp-libvips-")) continue;
    if (!existsSync(path.join(source, pkg))) {
      fail(`the server needs @img/${pkg}, which is not installed in frontend/node_modules`);
    }
    await fs.cp(path.join(source, pkg), path.join(staged, pkg), { recursive: true });
    const lib = await fs.readdir(path.join(staged, pkg, "lib")).catch(() => []);
    if (!lib.some((entry) => entry.startsWith("libvips-cpp.so"))) {
      fail(
        `@img/${pkg} carries no libvips shared library — reinstall the frontend's ` +
          `dependencies with optional ones enabled (npm install --include=optional)`,
      );
    }
    restored.push(`@img/${pkg}`);
  }
  return restored;
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
    `// Generated by electron/scripts/build.mjs — do not edit.\n` +
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
    `// Written and deleted by electron/scripts/build.mjs. Not part of the bundle.\n` +
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
  `# Changing either of those means rebuilding the app (electron/scripts/build.mjs).\n` +
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
 * The window shape the answers decide goes into shell.json, read by main.js
 * at launch; everything electron-builder needs goes into a generated config
 * so a build never leaves the repository dirty. Each flow declares whether
 * the staged resources/ ships — the shell-only build carries none.
 */
async function writeShellConfig(answers, { resources }) {
  await fs.writeFile(
    path.join(SHELL, "shell.json"),
    `${JSON.stringify({ fullscreen: answers.fullscreen ?? true }, null, 2)}\n`,
  );

  const linuxTargets = { appimage: "AppImage", deb: "deb", rpm: "rpm" };
  const winTargets = { nsis: "nsis", msi: "msi" };
  const targets = answers.targets ?? [];
  const { productName } = JSON.parse(await fs.readFile(path.join(SHELL, "package.json"), "utf8"));
  const config = {
    appId: "com.verticalreferencesolutionsblueprint.desktop",
    productName,
    asar: true,
    files: ["main.js", "server-entry.js", "ui/**", "shell.json"],
    // Chromium's own UI strings only — the window has no browser chrome, and
    // the kiosk's languages come from its country pack.
    electronLanguages: ["en-US"],
    directories: { output: "out" },
    afterPack: "./electron-fuses.js",
    linux: {
      target: targets.map((t) => linuxTargets[t]).filter(Boolean),
      executableName: "kiosk-desktop",
      icon: "icons/icon.png",
      category: "Utility",
    },
    // The default (FUSE2) toolset emits AppImages that dlopen libfuse.so.2,
    // which Ubuntu 22.04+ no longer ships; the static-runtime toolset needs no
    // libfuse2. Its runtime cannot read xz squashfs, so compression is zstd.
    toolsets: { appimage: "1.0.3" },
    appImage: { compression: "zstd" },
    win: {
      target: targets.map((t) => winTargets[t]).filter(Boolean),
      icon: "icons/icon.ico",
    },
    nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  };
  if (config.linux.target.length === 0) delete config.linux.target;
  if (config.win.target.length === 0) delete config.win.target;
  if (resources) config.extraResources = [{ from: "resources", to: "resources" }];

  const file = path.join(SHELL, "electron-builder.config.json");
  await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
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

async function ensureDependencies() {
  const present = (pkg) => existsSync(path.join(SHELL, "node_modules", pkg));
  if (present("esbuild") && present("electron") && present("electron-builder")) return;
  step("Installing the shell's build dependencies");
  await run("npm", ["install"], SHELL, proxyEnv());
}

/**
 * `npm install` here also runs electron's postinstall, which downloads the
 * Electron binary through @electron/get rather than npm's own registry
 * client — it only reads HTTP_PROXY/HTTPS_PROXY when ELECTRON_GET_USE_PROXY
 * is set, so a proxy that already works for npm silently stops that download.
 */
function proxyEnv() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy;
  return proxy ? { ELECTRON_GET_USE_PROXY: process.env.ELECTRON_GET_USE_PROXY || "1" } : {};
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

// Only the top level of out/ — electron-builder writes the distributables
// there, while out/win-unpacked holds the bare app binary and NSIS's
// elevate.exe, neither of which runs outside that directory.
async function findBundles(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(AppImage|deb|rpm|exe|msi)$/.test(entry.name)) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

function fail(message) {
  console.error(`\n\x1b[31m✗ ${message}\x1b[0m\n`);
  process.exit(1);
}

await main();
