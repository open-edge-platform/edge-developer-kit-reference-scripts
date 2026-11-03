#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Run a command with config.yaml's browser-visible settings in its environment:
 * `node scripts/with-kiosk-env.mjs next build`. Turbopack freezes NEXT_PUBLIC_*
 * values at build time from the real environment (next.config.ts's `env` never
 * reaches it), so they must be exported before the build starts. Real
 * environment variables still win — values are only filled in when absent.
 * PORT is filled the same way, from the kiosk's kiosk.json, so `npm run dev`
 * serves where the launchers and the Playwright configs expect it.
 *
 * It is also the server's supervisor: a command that exits with code 77 asked
 * to be started again (a settings save at /settings — see
 * src/app/api/_lib/restart.ts) and is re-run in place, with config.yaml read
 * afresh. That makes `npm run start` restartable on its own; `next dev`
 * handles the code itself and never surfaces it here.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const RESTART_EXIT_CODE = 77;

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: with-kiosk-env.mjs <command> [args...]");
  process.exit(2);
}

async function applyEnv() {
  const { readKioskConfig } = await import("../src/lib/kiosk-config.ts");
  for (const [key, value] of Object.entries(readKioskConfig())) {
    if (key.startsWith("NEXT_PUBLIC_") && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  const kiosk = new URL("../../kiosk.json", import.meta.url);
  if (process.env.PORT === undefined && existsSync(kiosk)) {
    const { port } = JSON.parse(readFileSync(kiosk, "utf8"));
    if (port) process.env.PORT = String(port);
  }
}

function run() {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, KIOSK_SUPERVISED: "1" },
    });
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
    child.on("error", (error) => {
      console.error(`with-kiosk-env: could not run ${cmd}: ${error.message}`);
      resolve(1);
    });
  });
}

await applyEnv();
// The browser's voice activity detection model and runtime, served from public/vad/.
await (await import("./vad-assets.mjs")).ensureVadAssets();
let code = await run();
while (code === RESTART_EXIT_CODE) {
  console.log("with-kiosk-env: restart requested — starting again");
  code = await run();
}
process.exit(code);
