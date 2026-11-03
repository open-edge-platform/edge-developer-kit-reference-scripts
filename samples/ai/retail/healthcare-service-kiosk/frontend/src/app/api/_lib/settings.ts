// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The settings page's half of config.yaml: read the terminal's own file,
 * write edits back into it with every comment in place (the file is mostly
 * documentation), and say which values the running server actually has.
 *
 * The file is the one the loader reads (src/lib/kiosk-config.ts): the
 * writable data directory of a packaged kiosk, the frontend root of a
 * checkout. The committed reference profile a fresh checkout falls back to
 * is never written — that is what `fallback` guards.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseDocument } from "yaml";
import {
  flattenKioskConfig,
  kioskConfigFiles,
  parseKioskConfigText,
  settingEnv,
} from "@/lib/kiosk-config";
import { SETTING_FIELDS, type SettingField } from "@/lib/settings-schema";
import { PATH_CHARS } from "@/lib/validation";
import { restartSupported } from "./restart";

export type SettingsSnapshot = {
  /** The file being edited, as shown to the operator. */
  file: string;
  /** Its text, for the raw editor. */
  text: string;
  /** The machine-local override file, when one exists. */
  local: string | null;
  /** Form value per schema key, as the file has it ("" = not set). */
  values: Record<string, string>;
  /** What the running server has for the same keys — differs from `values`
   *  after a save (until a restart) and under an environment override. */
  running: Record<string, string>;
  /** Keys config.local.yaml sets — a save here is shadowed by it. */
  overridden: string[];
  /** Whether "restart" is a button or an instruction. */
  restart: "supervised" | "manual";
};

export class SettingsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "SettingsError";
  }
}

function files() {
  const found = kioskConfigFiles(process.env.KIOSK_DATA_DIR || process.cwd());
  if (found.fallback) {
    throw new SettingsError(
      "this terminal has no config.yaml yet — run the launcher once (./setup.sh) to create it",
      409,
    );
  }
  return found;
}

/** Rebuilt character by character for the scan's taint analysis — see the
 *  fix-coverity-issues skill; the loop has to sit beside the fs call. */
function readText(file: string): string {
  let target = "";
  for (const ch of file) {
    let ok = "";
    for (const allowed of PATH_CHARS) if (allowed === ch) { ok = allowed; break; }
    if (!ok) throw new SettingsError("the settings file path contains a forbidden character", 500);
    target += ok;
  }
  if (target.split(/[/\\]/).includes("..")) {
    throw new SettingsError("the settings file path contains a traversal segment", 500);
  }
  return existsSync(target) ? readFileSync(target, "utf8") : "";
}

/** The previous text is kept beside the file as `.bak` — one step back for
 *  an edit that broke the terminal. */
function writeText(file: string, text: string, previous: string): void {
  let target = "";
  for (const ch of file) {
    let ok = "";
    for (const allowed of PATH_CHARS) if (allowed === ch) { ok = allowed; break; }
    if (!ok) throw new SettingsError("the settings file path contains a forbidden character", 500);
    target += ok;
  }
  if (target.split(/[/\\]/).includes("..")) {
    throw new SettingsError("the settings file path contains a traversal segment", 500);
  }
  if (previous !== "") writeFileSync(`${target}.bak`, previous);
  writeFileSync(target, text);
}

export function readSettings(): SettingsSnapshot {
  const { main, local } = files();
  const text = readText(main);
  const values: Record<string, string> = {};
  const running: Record<string, string> = {};
  const own = flattenKioskConfig(parseKioskConfigText(text)).values;
  const hasLocal = existsSync(local);
  const overrides = hasLocal ? flattenKioskConfig(parseKioskConfigText(readText(local))).values : {};
  const overridden: string[] = [];
  for (const key of SETTING_FIELDS.keys()) {
    const env = settingEnv(key);
    if (!env) continue;
    values[key] = own[env] ?? "";
    running[key] = process.env[env] ?? "";
    if (env in overrides) overridden.push(key);
  }
  return {
    file: main,
    text,
    local: hasLocal ? local : null,
    values,
    running,
    overridden,
    restart: restartSupported() ? "supervised" : "manual",
  };
}

/** The YAML value a form string stands for, by the field's kind. "" is
 *  written as "" — the loader reads that as "not set", and it is the idiom
 *  the profiles already use for a service switched off on purpose. */
function toYaml(field: SettingField, raw: string): unknown {
  const value = raw.trim();
  if (value === "") return "";
  switch (field.kind) {
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new SettingsError(`${field.label} must be a number`);
      return n;
    }
    case "boolean":
      if (value !== "true" && value !== "false") {
        throw new SettingsError(`${field.label} must be true or false`);
      }
      return value === "true";
    case "select":
      if (!field.options?.includes(value)) {
        throw new SettingsError(`${field.label} must be one of: ${field.options?.join(", ")}`);
      }
      return value;
    case "json": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new SettingsError(`${field.label} must be valid JSON`);
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new SettingsError(`${field.label} must be a JSON object`);
      }
      return parsed;
    }
    case "list":
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    case "map": {
      const out: Record<string, string | null> = {};
      for (const pair of value.split(";")) {
        const entry = pair.trim();
        if (!entry) continue;
        const [k = "", v = ""] = entry.split("=");
        if (!k.trim()) throw new SettingsError(`${field.label}: every entry needs a key before "="`);
        out[k.trim()] = v.trim() === "" ? null : v.trim();
      }
      return out;
    }
    default:
      return value;
  }
}

/** Write the given form values into the file, comments and all. */
export function writeSettings(values: Record<string, string>): SettingsSnapshot {
  const { main } = files();
  const previous = readText(main);
  const doc = parseDocument(previous);
  if (doc.errors.length > 0) {
    throw new SettingsError(`config.yaml does not parse: ${doc.errors[0].message}`, 409);
  }
  for (const [key, raw] of Object.entries(values)) {
    const field = SETTING_FIELDS.get(key);
    if (!field) throw new SettingsError(`unknown setting: ${key}`);
    if (typeof raw !== "string") throw new SettingsError(`${field.label} must be a string`);
    doc.setIn(key.split("."), toYaml(field, raw));
  }
  writeText(main, doc.toString(), previous);
  return readSettings();
}

/** Replace the file with text the operator edited by hand. It has to parse
 *  as a settings mapping; keys the kiosk does not know are allowed and
 *  reported back, as the loader would at start. */
export function writeSettingsText(text: string): SettingsSnapshot & { unknown: string[] } {
  const { main } = files();
  let unknown: string[];
  try {
    unknown = flattenKioskConfig(parseKioskConfigText(text)).unknown;
  } catch (error) {
    throw new SettingsError((error as Error).message);
  }
  const previous = readText(main);
  writeText(main, text.endsWith("\n") ? text : `${text}\n`, previous);
  return { ...readSettings(), unknown };
}
