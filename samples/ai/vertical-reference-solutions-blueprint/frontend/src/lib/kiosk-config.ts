// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * config.yaml -> process.env. Precedence, highest first: real environment
 * variables, config.local.yaml, config.yaml (or configs/reference.yaml until a
 * launcher has copied one out), the code defaults. An absent key
 * is never assigned, so "unset" keeps its meaning. Node only — client
 * components keep reading `process.env.NEXT_PUBLIC_*`, which Next inlines at
 * build time.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

/** Env-var NAMES (not values) for the cms credential settings, held apart so
 *  scanners don't misread the mapping literals as embedded credentials. */
const CMS_CREDENTIAL_ENV_NAMES = ["PAYLOAD_SECRET", "PAYLOAD_ADMIN_PASSWORD"] as const;

/** YAML path -> environment variable. The shape mirrors config.yaml exactly. */
const SETTINGS = {
  api: { base_url: "NEXT_PUBLIC_KIOSK_API_URL" },
  terminal: { mode: "NEXT_PUBLIC_KIOSK_MODE" },
  country: { pack: "NEXT_PUBLIC_KIOSK_PACK" },
  locale: {
    language: "NEXT_PUBLIC_KIOSK_LANG",
    money_locale: "NEXT_PUBLIC_KIOSK_MONEY_LOCALE",
    date_locale: "NEXT_PUBLIC_KIOSK_DATE_LOCALE",
    clock_locale: "NEXT_PUBLIC_KIOSK_CLOCK_LOCALE",
    currency: "NEXT_PUBLIC_KIOSK_CURRENCY",
  },
  session: {
    restart_ms: "NEXT_PUBLIC_KIOSK_RESTART_MS",
    idle_ms: "NEXT_PUBLIC_KIOSK_IDLE_MS",
    verification_ttl_ms: "KIOSK_VERIFICATION_TTL_MS",
  },
  mock: {
    currency: "KIOSK_CURRENCY",
    processing_fee: "KIOSK_PROCESSING_FEE",
    latency_ms: "KIOSK_MOCK_LATENCY_MS",
    identity: {
      read_ms: "KIOSK_IDENTITY_READ_MS",
      scan_ms: "KIOSK_IDENTITY_SCAN_MS",
      citizen: "KIOSK_READER_CITIZEN",
    },
  },
  nfc: {
    gesture: "NEXT_PUBLIC_KIOSK_ID_GESTURE",
    driver: "KIOSK_NFC_DRIVER",
    simulate: "KIOSK_NFC_SIMULATE",
    reader: "KIOSK_NFC_READER",
    timeout_ms: "KIOSK_NFC_TIMEOUT_MS",
    uid_command: "KIOSK_NFC_UID_COMMAND",
    unknown_card: "KIOSK_NFC_UNKNOWN_CARD",
    cards: "KIOSK_NFC_CARDS",
  },
  cms: {
    kiosk_key: "KIOSK_CMS_KEY",
    payload_secret: CMS_CREDENTIAL_ENV_NAMES[0],
    database_url: "DATABASE_URL",
    admin_email: "PAYLOAD_ADMIN_EMAIL",
    admin_password: CMS_CREDENTIAL_ENV_NAMES[1],
    citizens_csv: "KIOSK_CITIZENS_CSV",
  },
  llm: {
    mock: "KIOSK_LLM_MOCK",
    mock_verdict: "KIOSK_LLM_MOCK_VERDICT",
    base_url: "KIOSK_LLM_BASE_URL",
    model: "KIOSK_LLM_MODEL",
    api_key: "KIOSK_LLM_API_KEY",
    timeout_ms: "KIOSK_LLM_TIMEOUT_MS",
    health_path: "KIOSK_LLM_HEALTH_PATH",
    health_check: "KIOSK_LLM_HEALTH_CHECK",
    max_tokens: "KIOSK_LLM_MAX_TOKENS",
    extra_body: "KIOSK_LLM_EXTRA_BODY",
    tool_call_shim: "KIOSK_LLM_TOOL_CALL_SHIM",
  },
  ocr: {
    base_url: "KIOSK_OCR_BASE_URL",
    timeout_ms: "KIOSK_OCR_TIMEOUT_MS",
    dpi: "KIOSK_OCR_DPI",
    health_path: "KIOSK_OCR_HEALTH_PATH",
    health_check: "KIOSK_OCR_HEALTH_CHECK",
  },
  face: {
    base_url: "KIOSK_FACE_BASE_URL",
    require_match: "KIOSK_FACE_REQUIRE_MATCH",
    timeout_ms: "KIOSK_FACE_TIMEOUT_MS",
    min_similarity: "KIOSK_FACE_MIN_SIMILARITY",
    max_frame_bytes: "KIOSK_FACE_MAX_FRAME_BYTES",
    photos_dir: "KIOSK_FACE_PHOTOS_DIR",
    seed_dir: "KIOSK_FACES_SEED_DIR",
    health_path: "KIOSK_FACE_HEALTH_PATH",
    health_check: "KIOSK_FACE_HEALTH_CHECK",
  },
  agent: {
    mcp_url: "KIOSK_MCP_URL",
    turns: "KIOSK_AGENT_TURNS",
    max_steps: "KIOSK_AGENT_MAX_STEPS",
    stop: "KIOSK_AGENT_STOP",
  },
  voice: {
    languages: "KIOSK_VOICE_LANGUAGES",
    hands_free: "NEXT_PUBLIC_KIOSK_HANDS_FREE",
    read_aloud: "NEXT_PUBLIC_KIOSK_READ_ALOUD",
    wait_for_speech: "NEXT_PUBLIC_KIOSK_WAIT_FOR_SPEECH",
    barge_in: "NEXT_PUBLIC_KIOSK_BARGE_IN",
    vad_silence_ms: "NEXT_PUBLIC_KIOSK_VAD_SILENCE_MS",
    vad_sensitivity: "NEXT_PUBLIC_KIOSK_VAD_SENSITIVITY",
    stt: {
      base_url: "KIOSK_STT_BASE_URL",
      timeout_ms: "KIOSK_STT_TIMEOUT_MS",
      language: "KIOSK_STT_LANGUAGE",
      denoise: "KIOSK_STT_DENOISE",
      vocabulary: "KIOSK_STT_VOCABULARY",
      health_path: "KIOSK_STT_HEALTH_PATH",
      health_check: "KIOSK_STT_HEALTH_CHECK",
    },
    tts: {
      base_url: "KIOSK_TTS_BASE_URL",
      timeout_ms: "KIOSK_TTS_TIMEOUT_MS",
      voice: "KIOSK_TTS_VOICE",
      speed: "KIOSK_TTS_SPEED",
      format: "KIOSK_TTS_FORMAT",
      max_chars: "KIOSK_TTS_MAX_CHARS",
      health_path: "KIOSK_TTS_HEALTH_PATH",
      health_check: "KIOSK_TTS_HEALTH_CHECK",
    },
  },
  prompts: {
    assistant: "KIOSK_PROMPT_ASSISTANT",
    agent: "KIOSK_PROMPT_AGENT",
    agent_single: "KIOSK_PROMPT_AGENT_SINGLE",
    document: "KIOSK_PROMPT_DOCUMENT",
    address_proof: "KIOSK_PROMPT_ADDRESS_PROOF",
    relationship_proof: "KIOSK_PROMPT_RELATIONSHIP_PROOF",
    group_capture: "KIOSK_PROMPT_GROUP_CAPTURE",
    route_service: "KIOSK_PROMPT_ROUTE_SERVICE",
    extract_answers: "KIOSK_PROMPT_EXTRACT_ANSWERS",
    repair_transcript: "KIOSK_PROMPT_REPAIR_TRANSCRIPT",
    detect_language: "KIOSK_PROMPT_DETECT_LANGUAGE",
  },
  documents: {
    source: "NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE",
    require_verification: "KIOSK_REQUIRE_DOCUMENT_VERIFICATION",
    single_document_per_capture: "KIOSK_SINGLE_DOCUMENT_PER_CAPTURE",
    uploads_dir: "KIOSK_UPLOADS_DIR",
    max_upload_bytes: "KIOSK_UPLOAD_MAX_BYTES",
    mocks_dir: "KIOSK_SCANNER_MOCKS",
    scanner: {
      driver: "KIOSK_SCANNER_DRIVER",
      profile: "KIOSK_SCANNER_PROFILE",
      bin: "KIOSK_SCANNER_BIN",
      device: "KIOSK_SCANNER_DEVICE",
      resolution: "KIOSK_SCANNER_RESOLUTION",
      mode: "KIOSK_SCANNER_MODE",
      source: "KIOSK_SCANNER_SOURCE",
      args: "KIOSK_SCANNER_ARGS",
      timeout_ms: "KIOSK_SCANNER_TIMEOUT_MS",
      simulate: "KIOSK_SCANNER_SIMULATE",
      status_bin: "KIOSK_SCANNER_STATUS_BIN",
      status_args: "KIOSK_SCANNER_STATUS_ARGS",
      wait_ms: "KIOSK_SCANNER_WAIT_MS",
      poll_ms: "KIOSK_SCANNER_POLL_MS",
    },
  },
} as const;

/** Settings YAML expresses more readably than the flat string the code wants. */
const SERIALIZE: Record<string, (value: unknown) => string> = {
  KIOSK_LLM_EXTRA_BODY: (value) =>
    typeof value === "string" ? value : JSON.stringify(value),
  // A YAML list, joined into the comma-separated form.
  KIOSK_AGENT_STOP: (value) =>
    Array.isArray(value) ? value.map(String).join(",") : String(value),
  // A YAML mapping, joined into "UID=citizen;UID=citizen".
  KIOSK_NFC_CARDS: (value) =>
    typeof value === "string"
      ? value
      : Object.entries(value as Record<string, unknown>)
          .map(([uid, citizen]) => `${uid}=${citizen}`)
          .join(";"),
  // A YAML mapping (or list) of language -> TTS voice, joined into
  // "en=af_heart;ms=" — an absent voice means "the default voice".
  KIOSK_VOICE_LANGUAGES: (value) => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((language) => `${String(language)}=`).join(";");
    return Object.entries(value as Record<string, unknown>)
      .map(([language, voice]) => `${language}=${voice == null ? "" : String(voice)}`)
      .join(";");
  },
  // Canonical: [alias, alias] -> "Canonical=alias|alias;Canonical=alias"
  KIOSK_STT_VOCABULARY: (value) => {
    if (typeof value === "string" || Array.isArray(value)) {
      return Array.isArray(value) ? value.map(String).join(";") : value;
    }
    return Object.entries(value as Record<string, unknown>)
      .map(([term, aliases]) => {
        const list = Array.isArray(aliases) ? aliases : [aliases];
        return `${term}=${list.map(String).join("|")}`;
      })
      .join(";");
  },
};

type Tree = { [key: string]: string | Tree };
type Plain = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Plain =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** config.local.yaml over config.yaml, key by key. */
function merge(base: Plain, override: Plain): Plain {
  const out: Plain = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] =
      isPlainObject(value) && isPlainObject(out[key])
        ? merge(out[key] as Plain, value)
        : value;
  }
  return out;
}

function readYaml(file: string): Plain {
  if (!existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not parse ${path.basename(file)}: ${(error as Error).message}`,
    );
  }
  if (parsed == null) return {};
  if (!isPlainObject(parsed)) {
    throw new Error(`${path.basename(file)} must be a mapping of settings.`);
  }
  return parsed;
}

function flatten(
  config: Plain,
  settings: Tree,
  trail: string[],
  out: Record<string, string>,
  unknown: string[],
): void {
  for (const [key, value] of Object.entries(config)) {
    const target = settings[key];
    const where = [...trail, key];
    if (target === undefined) {
      unknown.push(where.join("."));
      continue;
    }
    // An absent value means "not set" — leave the code default in place.
    if (value === null || value === undefined || value === "") continue;
    if (typeof target === "string") {
      out[target] = (SERIALIZE[target] ?? String)(value);
    } else if (isPlainObject(value)) {
      flatten(value, target, where, out, unknown);
    } else {
      unknown.push(`${where.join(".")} (expected a group of settings)`);
    }
  }
}

export function readKioskConfig(root = process.cwd()): Record<string, string> {
  const selected = process.env.KIOSK_CONFIG_FILE;
  const primary = selected
    ? path.resolve(root, selected)
    : path.join(root, "config.yaml");
  // config.yaml is per-install and gitignored — the launchers copy it out of
  // configs/. A checkout that has not run setup yet reads the committed
  // reference profile instead of falling back to the code defaults in silence.
  const main =
    selected || existsSync(primary)
      ? primary
      : path.join(root, "configs", "reference.yaml");
  // Machine overrides sit beside the selected profile; for the default (and
  // for the reference stand-in) that is the frontend root.
  const local = selected
    ? path.join(path.dirname(main), "config.local.yaml")
    : path.join(root, "config.local.yaml");

  const config = merge(readYaml(main), readYaml(local));
  const values: Record<string, string> = {};
  const unknown: string[] = [];
  flatten(config, SETTINGS, [], values, unknown);

  if (unknown.length > 0) {
    console.warn(
      `[kiosk-config] ignoring unknown setting(s) in config.yaml: ${unknown.join(", ")}`,
    );
  }
  return values;
}

const APPLIED = Symbol.for("kiosk.config.applied");

/** Copy config.yaml into process.env, never overwriting existing env values. Idempotent. */
export function applyKioskConfig(root = process.cwd()): Record<string, string> {
  const globals = globalThis as { [APPLIED]?: Record<string, string> };
  if (globals[APPLIED]) return globals[APPLIED];

  const values = readKioskConfig(root);
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  globals[APPLIED] = values;
  return values;
}

/** The browser-visible subset, for `next.config.ts` to inline into the client bundle. */
export function publicKioskEnv(root = process.cwd()): Record<string, string> {
  const values = applyKioskConfig(root);
  return Object.fromEntries(
    Object.keys(values)
      .filter((key) => key.startsWith("NEXT_PUBLIC_"))
      .map((key) => [key, process.env[key] as string]),
  );
}
