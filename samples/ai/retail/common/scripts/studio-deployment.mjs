#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The Edge AI Studio's deployment.json, assembled from each kiosk's own
 * <kiosk>/deployment.json for its terminal mode. Shared by scripts/common.sh,
 * scripts/win/common.ps1, scripts/bundle.mjs and electron/scripts/build.mjs;
 * see docs/configuration.md.
 *
 *   node scripts/studio-deployment.mjs install [--profile <p>] [--file <f>] <studio dir> <kiosk dir>...
 *   node scripts/studio-deployment.mjs services [--profile <p>] [--file <f>] <kiosk dir>...
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA = "./docs/deployment.schema.json";

// The `terminal:` block's shape is frontend/src/lib/kiosk-config.ts's — keep in sync.
export function kioskTerminalMode(kioskDir, profile = "reference") {
  if (process.env.NEXT_PUBLIC_KIOSK_MODE) return process.env.NEXT_PUBLIC_KIOSK_MODE;
  const frontend = path.join(kioskDir, "frontend");
  for (const file of [
    path.join(frontend, "config.local.yaml"),
    path.join(frontend, "config.yaml"),
    path.join(frontend, "configs", `${profile}.yaml`),
  ]) {
    if (!fs.existsSync(file)) continue;
    let inTerminal = false;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (/^terminal:/.test(line)) { inTerminal = true; continue; }
      if (/^[A-Za-z_]/.test(line)) inTerminal = false;
      const match = inTerminal && line.match(/^\s+mode:\s*["']?([A-Za-z0-9_-]+)/);
      if (match) return match[1];
    }
  }
  return "touch";
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: ${error.code === "ENOENT" ? "not found" : error.message}`);
  }
}

function kioskModesOf(kioskDir) {
  const file = path.join(kioskDir, "deployment.json");
  if (!fs.existsSync(file)) {
    throw new Error(`${file} is missing — each kiosk lists the studio services its terminal modes run there`);
  }
  const { modes } = readJson(file);
  if (!modes || typeof modes !== "object") throw new Error(`${file} has no "modes"`);
  return { file, modes };
}

export const kioskModes = (kioskDir) => Object.keys(kioskModesOf(kioskDir).modes);

export function kioskServices(kioskDir, mode) {
  const { file, modes } = kioskModesOf(kioskDir);
  const chain = [mode];
  while (typeof modes[chain.at(-1)] === "string") {
    const next = modes[chain.at(-1)];
    if (chain.includes(next)) throw new Error(`${file}: modes alias in a loop (${[...chain, next].join(" → ")})`);
    chain.push(next);
  }
  const services = modes[chain.at(-1)]?.services;
  if (!services || typeof services !== "object") {
    throw new Error(`${file} has no services for the "${mode}" terminal mode (it lists: ${Object.keys(modes).join(", ")})`);
  }
  return structuredClone(services);
}

const online = (entry) => entry?.status === "online";

export const onlineServices = (deployment) =>
  Object.entries(deployment.services ?? {}).filter(([, entry]) => online(entry)).map(([name]) => name);

function kioskId(kioskDir) {
  try {
    return readJson(path.join(kioskDir, "kiosk.json")).id ?? path.basename(kioskDir);
  } catch {
    return path.basename(kioskDir);
  }
}

// One studio serves every kiosk: the one running the most services sets the presets.
function mergeServices(needs, warn) {
  const ranked = [...needs].sort(
    (a, b) => onlineServices({ services: b.services }).length - onlineServices({ services: a.services }).length,
  );
  const services = {};
  const owner = {};
  for (const { label, services: wanted } of ranked) {
    for (const [name, entry] of Object.entries(wanted)) {
      if (!(name in services) || (online(entry) && !online(services[name]))) {
        services[name] = entry;
        owner[name] = label;
      } else if (online(entry) && JSON.stringify(entry) !== JSON.stringify(services[name])) {
        warn(`${name}: ${label} wants other presets than ${owner[name]} — one studio serves both, ${owner[name]}'s apply`);
      }
    }
  }
  return services;
}

/** `kiosks`: [{ dir, mode }]. `file` replaces the kiosks' deployments with one fixed file. */
export function resolveDeployment(kiosks, { file = "", warn = () => {} } = {}) {
  if (file) return { deployment: readJson(file), file, source: path.basename(file) };
  const needs = kiosks.map(({ dir, mode }) => ({
    label: `${kioskId(dir)} (${mode})`,
    services: kioskServices(dir, mode),
  }));
  return {
    deployment: { $schema: SCHEMA, services: mergeServices(needs, warn) },
    source: needs.map(({ label }) => label).join(", "),
  };
}

export function installDeployment(studioDir, resolved, { info, ok }) {
  if (fs.existsSync(path.join(studioDir, "kiosk.json"))) {
    throw new Error(`${studioDir} is a kiosk folder, not the Edge AI Studio checkout`);
  }
  const target = path.join(studioDir, "deployment.json");
  const content = resolved.file
    ? fs.readFileSync(resolved.file)
    : Buffer.from(`${JSON.stringify(resolved.deployment, null, 2)}\n`);
  if (fs.existsSync(target) && fs.readFileSync(target).equals(content)) {
    info(`Studio deployment.json already matches ${resolved.source}`);
    return;
  }
  if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`);
  fs.writeFileSync(target, content);
  ok(`Installed the studio services for ${resolved.source} into ${target}`);
}

function main(argv) {
  const tty = process.stdout.isTTY;
  const color = (code, text) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
  const info = (message) => console.log(`${color(1, "==>")} ${message}`);
  const ok = (message) => console.log(`${color(32, " ✓ ")} ${message}`);
  const warn = (message) => console.error(`${color(33, "warning:")} ${message}`);

  const [command, ...rest] = argv;
  let profile = "", file = "";
  const dirs = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--profile") profile = rest[++i] ?? "";
    else if (rest[i] === "--file") file = rest[++i] ?? "";
    else dirs.push(path.resolve(rest[i]));
  }
  const kioskDirs = command === "install" ? dirs.slice(1) : dirs;
  if (command === "install" && !fs.existsSync(dirs[0] ?? "")) throw new Error(`studio dir not found: ${dirs[0]}`);
  if (!["install", "services"].includes(command) || !kioskDirs.length) {
    throw new Error("usage: studio-deployment.mjs install|services [--profile <p>] [--file <f>] [<studio dir>] <kiosk dir>...");
  }
  const kiosks = kioskDirs.map((dir) => ({ dir, mode: kioskTerminalMode(dir, profile || "reference") }));
  const resolved = resolveDeployment(kiosks, { file, warn });
  if (command === "install") installDeployment(dirs[0], resolved, { info, ok });
  else for (const name of onlineServices(resolved.deployment)) console.log(name);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`${process.stderr.isTTY ? "\x1b[31merror:\x1b[0m" : "error:"} ${error.message}`);
    process.exit(1);
  }
}
