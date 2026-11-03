// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The kiosks a build carries and the terminal mode each runs in. Shared by
 * scripts/bundle.mjs and electron/scripts/build.mjs: the embedded bundle is one
 * studio with every chosen kiosk as a sample, so both need the same list.
 *
 * The launchers hand the chosen kiosks over in KIOSK_DIR_LIST (absolute kiosk
 * folders joined with path.delimiter); without it, KIOSK_DIR is the only one.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kioskTerminalMode } from "./studio-deployment.mjs";

export const COMMON_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const WORKSPACE_DIR = path.resolve(COMMON_DIR, "..");

/** The identity of the packaged platform app, whichever kiosks it carries. */
export const PLATFORM = JSON.parse(fs.readFileSync(path.join(COMMON_DIR, "platform.json"), "utf8"));

export function readKiosk(dir) {
  const json = JSON.parse(fs.readFileSync(path.join(dir, "kiosk.json"), "utf8"));
  return {
    dir,
    folder: path.basename(dir),
    json,
    id: json.id,
    sampleId: json.studio.sampleId,
    title: json.studio.title,
    port: Number(json.studio.port),
  };
}

/** The chosen kiosk folders: KIOSK_DIR_LIST, else KIOSK_DIR, else the default kiosk. */
export function chosenKioskDirs() {
  const list = (process.env.KIOSK_DIR_LIST || "").split(path.delimiter).filter(Boolean);
  const dirs = list.length ? list : [process.env.KIOSK_DIR || "public-service-kiosk"];
  return [...new Set(dirs.map((dir) => path.resolve(WORKSPACE_DIR, dir)))];
}

export function chosenKiosks() {
  const kiosks = chosenKioskDirs().map(readKiosk);
  for (const key of ["sampleId", "port"]) {
    const seen = new Map();
    for (const kiosk of kiosks) {
      if (seen.has(kiosk[key])) {
        throw new Error(`${seen.get(kiosk[key])} and ${kiosk.id} share studio.${key} ${kiosk[key]} — one studio carries both, so give them different ones in kiosk.json`);
      }
      seen.set(kiosk[key], kiosk.id);
    }
  }
  return kiosks;
}

/** Does `name` (a kiosk.json id, folder name or studio sample id) name this kiosk? */
export const kioskMatches = (kiosk, name) => [kiosk.id, kiosk.folder, kiosk.sampleId].includes(name);

/**
 * Every `--mode` value given, in either spelling (`--mode touch`, `--mode=touch`).
 * A plain `<mode>` applies to every kiosk, `<kiosk>=<mode>` to that one only.
 */
export function modeArgs(argv) {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mode" && argv[i + 1] !== undefined) values.push(argv[++i]);
    else if (argv[i].startsWith("--mode=")) values.push(argv[i].slice("--mode=".length));
  }
  return values;
}

/**
 * Each kiosk's mode: what `values` (see modeArgs) set for it, later values
 * winning, else `fallback(kiosk)` — by default its configured terminal mode.
 */
export function resolveModes(kiosks, values, fallback = (kiosk) => kioskTerminalMode(kiosk.dir, process.env.KIOSK_PROFILE || "reference")) {
  const modes = new Map(kiosks.map((kiosk) => [kiosk.sampleId, undefined]));
  for (const value of values) {
    const at = value.indexOf("=");
    if (at === -1) {
      for (const kiosk of kiosks) modes.set(kiosk.sampleId, value);
      continue;
    }
    const name = value.slice(0, at);
    const kiosk = kiosks.find((k) => kioskMatches(k, name));
    if (!kiosk) throw new Error(`--mode ${value}: no kiosk "${name}" in this build (it carries ${kiosks.map((k) => k.id).join(", ")})`);
    modes.set(kiosk.sampleId, value.slice(at + 1));
  }
  for (const kiosk of kiosks) kiosk.mode = modes.get(kiosk.sampleId) || fallback(kiosk);
  return kiosks;
}
