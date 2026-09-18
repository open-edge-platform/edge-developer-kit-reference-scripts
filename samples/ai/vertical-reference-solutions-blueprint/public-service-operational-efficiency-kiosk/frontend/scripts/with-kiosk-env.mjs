#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Run a command with config.yaml's browser-visible settings in its environment:
 * `node scripts/with-kiosk-env.mjs next build`. Turbopack freezes NEXT_PUBLIC_*
 * values at build time from the real environment (next.config.ts's `env` never
 * reaches it), so they must be exported before the build starts. Real
 * environment variables still win — values are only filled in when absent.
 *
 * It is also the server's supervisor: a command that exits with code 77 asked
 * to be started again (a settings save at /settings — see
 * src/app/api/_lib/restart.ts) and is re-run in place, with config.yaml read
 * afresh. That makes `npm run start` restartable on its own; `next dev`
 * handles the code itself and never surfaces it here.
 */
import { spawn } from "node:child_process";

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
let code = await run();
while (code === RESTART_EXIT_CODE) {
  console.log("with-kiosk-env: restart requested — starting again");
  code = await run();
}
process.exit(code);
