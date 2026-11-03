#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Kiosk driver — a programmatic handle on the running kiosk.
 *
 * The kiosk is a Next.js app whose interesting surface is a multi-step touch /
 * chat flow: nothing about it can be checked with curl, because every step is
 * a React state transition behind a button. This drives a real Chromium at it.
 *
 * Two ways in:
 *
 *   node driver.mjs smoke [--mode=touch|chat]   canned end-to-end flow -> receipt
 *   node driver.mjs run  [--mode=...]           read commands from stdin
 *   node driver.mjs shot <route> [name]         one screenshot of one route
 *   node driver.mjs serve [--mode=...]          just start the server, detached
 *   node driver.mjs stop                        kill the server
 *
 * `run` is the general handle: pipe it a heredoc of commands (see COMMANDS
 * below) and it keeps ONE browser + page alive across all of them, so a flow
 * can be walked step by step from a single Bash call.
 *
 * Playwright is resolved via createRequire against <KIOSK_DIR>/frontend/package.json
 * (default public-service-kiosk),
 * so it always gets the kiosk frontend's own installed version.
 */
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const REPO = path.resolve(import.meta.dirname, "../../..");
const FRONTEND = path.join(REPO, process.env.KIOSK_DIR ?? "public-service-kiosk", "frontend");
const SHOTS = process.env.KIOSK_SHOTS ?? path.join(REPO, ".kiosk-run");
const BASE = process.env.KIOSK_BASE ?? "http://127.0.0.1:3000";

const require = createRequire(path.join(FRONTEND, "package.json"));
const { chromium } = require("playwright");

const log = (...a) => console.log(...a);
const die = (m) => { console.error(`error: ${m}`); process.exit(1); };

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

const health = async () => {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(4000) });
    return await r.json();
  } catch { return null; }
};

/** What NEXT_PUBLIC_KIOSK_MODE the running server was booted with, if we started it. */
const MODE_FILE = path.join(SHOTS, "mode");
const runningMode = () => { try { return readFileSync(MODE_FILE, "utf8").trim(); } catch { return null; } };

/**
 * Start `next dev` detached and wait for /api/health.
 *
 * setsid matters: a plain background job dies with the process group of
 * whatever shell launched it, which for an agent means the server vanishes
 * the moment the tool call returns.
 *
 * The mock env mirrors scripts/common.sh:export_mock_env — the gateway URLs
 * are blanked rather than left pointing at an absent studio, because a
 * *configured but unreachable* service fails /api/health and the kiosk paints
 * its out-of-service screen instead of the flow you wanted to drive.
 */
async function serve({ mode }) {
  if (await health()) {
    const was = runningMode();
    // terminal.mode reaches the browser as NEXT_PUBLIC_KIOSK_MODE, which Next
    // inlines into the client bundle when the server boots. A running server
    // cannot be talked into another mode — it has to be restarted.
    if (mode && was && was !== mode) {
      log(`server is in ${was} mode, ${mode} was asked for — restarting`);
      stop();
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      log(`server already up${was ? ` (mode=${was})` : ""}`);
      return;
    }
  }
  mkdirSync(SHOTS, { recursive: true });
  const logFile = path.join(SHOTS, "dev.log");
  const env = {
    ...process.env,
    KIOSK_LLM_MOCK: "true",
    KIOSK_REQUIRE_DOCUMENT_VERIFICATION: "false",
    KIOSK_OCR_BASE_URL: "",
    KIOSK_FACE_BASE_URL: "",
    KIOSK_STT_BASE_URL: "",
    KIOSK_TTS_BASE_URL: "",
    // The production config.yaml requires a live face match and forbids
    // simulated reads (face.require_match: true, nfc/scanner simulate:
    // never). Env beats config.yaml — relax those three, mirroring
    // scripts/common.sh:export_mock_env, or health fail-closes and the
    // identity step dead-ends at "card reader isn't available".
    KIOSK_FACE_REQUIRE_MATCH: "false",
    KIOSK_NFC_SIMULATE: "auto",
    KIOSK_SCANNER_SIMULATE: "auto",
    // Pin the mock ID reader to citizen 1 (NADIA RAHMAN) so the flow is
    // reproducible — unpinned, the reader stands in a random citizen and
    // every name assertion becomes a coin flip.
    KIOSK_READER_CITIZEN: "1",
    ...(mode ? { NEXT_PUBLIC_KIOSK_MODE: mode } : {}),
  };
  log(`starting next dev (mode=${mode ?? "config.yaml default"}) -> ${logFile}`);
  writeFileSync(MODE_FILE, mode ?? "");
  execSync(
    `setsid nohup npm run dev > ${JSON.stringify(logFile)} 2>&1 < /dev/null &`,
    { cwd: FRONTEND, env, shell: "/bin/bash", stdio: "ignore" },
  );
  for (let i = 0; i < 90; i++) {
    const h = await health();
    if (h) { log("health:", JSON.stringify(h)); if (!h.ok) log("WARNING: ok:false — expect the out-of-service screen"); return; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  die(`server did not answer ${BASE}/api/health within 180s — see ${logFile}`);
}

function stop() {
  // next dev (turbopack) leaves a next-server child, and `next start` is the
  // production server — match all three.
  //
  // The bracket is not decoration: `pkill -f "next dev"` also matches the
  // shell pkill is running in, because the pattern is part of that shell's own
  // command line. It kills its own parent and the real server survives.
  for (const pat of ["next[-]server", "next[ ]dev", "next[ ]start"]) {
    try { execSync(`pkill -f '${pat}'`, { stdio: "ignore" }); } catch { /* none running */ }
  }
  log("stopped");
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

async function open() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    args: [
      // The identity step calls getUserMedia. Headless Chromium has no camera,
      // and without these the permission prompt hangs the step instead of
      // falling through to the simulated scan.
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ["camera"],
    baseURL: BASE,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return { browser, page, errors };
}

/**
 * Click a button by accessible name.
 *
 * `.last()` is deliberate. Several kiosk screens wrap the whole card in an
 * outer button, so a substring name match hits both the wrapper and the real
 * control and Playwright's strict mode refuses the ambiguity. The innermost
 * match comes last in DOM order and is the one a citizen actually presses.
 */
const button = (page, name, exact = false) =>
  page.getByRole("button", { name, exact }).last();

async function click(page, name, exact = false) {
  await button(page, name, exact).click({ timeout: 30_000 });
}

const shot = async (page, name) => {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  log(`  shot -> ${file}`);
  return file;
};

const bodyText = (page) => page.locator("body").innerText();

// ---------------------------------------------------------------------------
// Command language (used by `run`, and by `smoke` internally)
// ---------------------------------------------------------------------------

const COMMANDS = `
  goto <route>            navigate, e.g. "goto /" or "goto /admin"
  click <name>            click a button whose accessible name contains <name>
  clickx <name>           same, but the name must match exactly
  wait <regex>            wait up to 60s for text matching <regex> to be visible
  find <regex>            report whether <regex> is currently visible (no wait)
  text                    print the page's visible text
  buttons                 list the accessible names of every visible button
  upload <n> <file>       set <file> on the nth (0-based) file input
  fill <selector> <value> fill an input
  eval <js>               evaluate <js> in the page and print the result
  ss <name>               screenshot to $KIOSK_SHOTS/<name>.png
  sleep <ms>              wait
  login                   sign in to the Payload admin (cms.admin_* from config.yaml)
  health                  print /api/health
  errors                  print console/page errors collected so far
`;

/** The seeded admin credentials, generated into config.yaml by the launchers. */
function adminLogin() {
  const config = readFileSync(path.join(FRONTEND, "config.yaml"), "utf8");
  const read = (key) => {
    const line = config
      .split("\n")
      .find((entry) => entry.trim().startsWith(`${key}:`) && !entry.trim().startsWith("#"));
    return (line ?? "").split(":").slice(1).join(":").replace(/\s+#.*$/, "").trim();
  };
  const email = read("admin_email");
  const password = read("admin_password");
  if (!email || !password) die("no cms.admin_email / cms.admin_password in <KIOSK_DIR>/frontend/config.yaml — run ./setup.sh");
  return { email, password };
}

/** /admin and /enroll are both behind the Payload session cookie. */
async function login(page) {
  const { email, password } = adminLogin();
  await page.goto("/admin/login", { waitUntil: "networkidle", timeout: 60_000 });
  await page.locator("#field-email").fill(email);
  await page.locator("#field-password").fill(password);
  await click(page, "Login");
  await page.getByText("Collections").first().waitFor({ state: "visible", timeout: 30_000 });
  log("  signed in to /admin");
}

async function exec(cmd, rest, { page, errors }) {
  switch (cmd) {
    case "goto":
      await page.goto(rest || "/", { waitUntil: "networkidle", timeout: 60_000 });
      return log(`  at ${page.url()}`);
    case "click":  return click(page, rest);
    case "clickx": return click(page, rest, true);
    case "wait":
      await page.getByText(new RegExp(rest, "i")).first()
        .waitFor({ state: "visible", timeout: 60_000 });
      return log(`  saw /${rest}/`);
    case "find": {
      const n = await page.getByText(new RegExp(rest, "i")).count();
      return log(`  /${rest}/ -> ${n} match(es)`);
    }
    case "text":    return log((await bodyText(page)).slice(0, 4000));
    case "buttons": return log(JSON.stringify(
      (await page.getByRole("button").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()),
      null, 1));
    case "upload": {
      const [n, ...f] = rest.split(/\s+/);
      await page.locator('input[type="file"]').nth(Number(n)).setInputFiles(f.join(" "));
      return log(`  uploaded to input #${n}`);
    }
    case "fill": {
      const [sel, ...v] = rest.split(/\s+/);
      await page.locator(sel).fill(v.join(" "));
      return log(`  filled ${sel}`);
    }
    case "eval":   return log(JSON.stringify(await page.evaluate(rest), null, 1));
    case "ss":     return void (await shot(page, rest || "shot"));
    case "sleep":  return new Promise((r) => setTimeout(r, Number(rest || 500)));
    case "login":  return login(page);
    case "health": return log(JSON.stringify(await health()));
    case "errors": return log(errors.length ? errors.join("\n") : "  (none)");
    default: throw new Error(`unknown command: ${cmd}`);
  }
}

async function run(session) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "quit" || line === "exit") break;
    const [cmd, ...rest] = line.split(/\s+/);
    log(`> ${line}`);
    try { await exec(cmd, rest.join(" "), session); }
    catch (e) { console.error(`  FAILED: ${e.message.split("\n")[0]}`); }
  }
}

// ---------------------------------------------------------------------------
// Canned end-to-end flow
// ---------------------------------------------------------------------------

/**
 * Road Tax Renewal, all the way to a receipt.
 *
 * Chosen because it is one of the two catalog services that take NO supporting
 * documents (the other is the traffic fine), so it reaches a receipt without
 * OCR or an LLM verdict — which is exactly what mock mode cannot provide.
 */
async function smokeTouch(session) {
  const { page } = session;
  await exec("goto", "/", session);
  await shot(page, "01-landing");
  await click(page, "Touch to Begin");

  await exec("wait", "Transport|Licensing|How can we help|Select", session);
  await shot(page, "02-categories");
  await click(page, "Transport & Licensing");
  await exec("wait", "Road Tax", session);
  await click(page, "Road Tax Renewal");

  await exec("wait", "Privacy notice & consent", session);
  await page.getByRole("checkbox").last().click();
  await click(page, "Agree & Continue");
  await shot(page, "03-consent");

  await exec("wait", "read — Nadia Rahman|Nadia Rahman", session);
  await click(page, "scan now");
  await exec("wait", "Identity confirmed|Welcome, Nadia", session);
  await shot(page, "04-identity");

  await exec("wait", "Select your vehicle|Renewal period", session);
  await click(page, "Renew ");
  await shot(page, "05-vehicle");

  await exec("wait", "Total due", session);
  await shot(page, "06-payment");
  await click(page, "QR / e-Wallet");

  // The touch kiosk parks on a "payment received" card and waits to be asked
  // for the receipt — the chat kiosk just streams it out instead.
  await exec("wait", "Payment received", session);
  await click(page, "View Receipt");
  await exec("wait", "You're all set|Case ID", session);
  await shot(page, "07-receipt");
  return bodyText(page);
}

async function smokeChat(session) {
  const { page } = session;
  await exec("goto", "/", session);
  await shot(page, "01-landing");
  await click(page, "Touch to Begin");

  await exec("wait", "I'm the kiosk assistant", session);
  await shot(page, "02-assistant");

  // Service first: the assistant only asks for the card once it knows which
  // service it is opening, so the identity overlay follows the chip.
  await click(page, "Road Tax Renewal (LKM)", true);
  await exec("wait", "Identity verified — welcome, Nadia Rahman|Action needed", session);
  await shot(page, "03-identity");

  await exec("wait", "vehicle registered with JPJ|Renewal period|months", session);
  await shot(page, "04-vehicle");
  await button(page, /^12 months|^1 year|months —/).click({ timeout: 30_000 });

  await exec("wait", "How would you like to pay", session);
  await shot(page, "05-payment");
  await click(page, "QR / e-Wallet");

  await exec("wait", "Case ID", session);
  await shot(page, "06-receipt");
  return bodyText(page);
}

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "help";
const flag = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

if (cmd === "help" || cmd === "--help") {
  log(`kiosk driver

  node driver.mjs serve [--mode=touch|chat]         start next dev, detached, mocked
  node driver.mjs stop                              stop it
  node driver.mjs smoke [--mode=touch|chat]         end-to-end flow -> receipt + screenshots
  node driver.mjs shot <route> [name]               screenshot one route
  node driver.mjs run  [--mode=...]                 read commands from stdin

commands accepted by \`run\`:${COMMANDS}
screenshots -> ${SHOTS}  (override with KIOSK_SHOTS)
base url    -> ${BASE}   (override with KIOSK_BASE)`);
  process.exit(0);
}

if (cmd === "stop") { stop(); process.exit(0); }

const mode = flag("mode");
if (cmd === "serve") { await serve({ mode }); process.exit(0); }

if (!existsSync(path.join(FRONTEND, "node_modules")) && !existsSync(path.join(REPO, "node_modules"))) {
  die(`dependencies are missing (no node_modules under public-service-kiosk/frontend or the repo root) — run ./setup.sh --skip-studio first`);
}

// Everything below needs a live server. serve() returns immediately when one
// is already up in the right mode, and restarts it when it is not — so it has
// to be called unconditionally, not only when health is down.
await serve({ mode });

const session = await open();
try {
  if (cmd === "shot") {
    const route = argv[1] ?? "/";
    await exec("goto", route, session);
    await shot(session.page, argv[2] ?? (route.replace(/\W+/g, "_") || "root"));
  } else if (cmd === "run") {
    await run(session);
  } else if (cmd === "smoke") {
    const m = mode ?? "touch";
    log(`smoke: ${m} kiosk`);
    const text = await (m === "chat" ? smokeChat(session) : smokeTouch(session));
    const caseId = text.match(/Case ID[:\s]*([A-Z0-9-]+)/i)?.[1];
    log(`\nSMOKE PASSED — reached the receipt${caseId ? ` (Case ID ${caseId})` : ""}`);
  } else {
    die(`unknown command: ${cmd} (try: help)`);
  }
  if (session.errors.length) {
    log(`\n${session.errors.length} console error(s):`);
    for (const e of session.errors.slice(0, 10)) log(`  ${e.slice(0, 200)}`);
  }
} catch (e) {
  await shot(session.page, "FAILURE");
  console.error(`\nFAILED: ${e.message.split("\n")[0]}`);
  console.error(`page text was:\n${(await bodyText(session.page)).slice(0, 1500)}`);
  process.exitCode = 1;
} finally {
  await session.browser.close();
}
