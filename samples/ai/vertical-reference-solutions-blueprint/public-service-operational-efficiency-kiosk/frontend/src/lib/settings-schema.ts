// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * What the settings page (/settings) puts a form field on, section by
 * section. Keys are the dotted config.yaml paths of src/lib/kiosk-config.ts;
 * anything not listed here — the prompts, the paths the shell sets — is still
 * editable on the page's raw config.yaml tab.
 *
 * Shared by the page and the route, so it imports nothing Node-only.
 */

export type SettingKind =
  /** Free text. */
  | "text"
  /** A number; blank leaves the code default in place. */
  | "number"
  /** true / false, with "default" for unset. */
  | "boolean"
  /** One of `options`. */
  | "select"
  /** Free text the page never echoes back in clear. */
  | "secret"
  /** A JSON object, edited as its text. */
  | "json"
  /** A YAML list, edited as comma-separated values. */
  | "list"
  /** A YAML mapping, edited as `key=value;key=value`. */
  | "map";

export type SettingField = {
  key: string;
  label: string;
  kind: SettingKind;
  hint?: string;
  options?: readonly string[];
  /** The code default, shown as the placeholder of a blank field. */
  placeholder?: string;
};

export type SettingSection = {
  id: string;
  title: string;
  note?: string;
  fields: SettingField[];
};

const bool = (key: string, label: string, hint?: string, placeholder?: string): SettingField =>
  ({ key, label, kind: "boolean", hint, placeholder });
const num = (key: string, label: string, hint?: string, placeholder?: string): SettingField =>
  ({ key, label, kind: "number", hint, placeholder });
const text = (key: string, label: string, hint?: string, placeholder?: string): SettingField =>
  ({ key, label, kind: "text", hint, placeholder });
const pick = (
  key: string,
  label: string,
  options: readonly string[],
  hint?: string,
  placeholder?: string,
): SettingField => ({ key, label, kind: "select", options, hint, placeholder });

const service = (prefix: string, healthPath: string) => [
  text(`${prefix}.health_path`, "Health path", "Appended to the base URL for the health probe.", healthPath),
  bool(`${prefix}.health_check`, "Health check", "Off skips health-gating this service.", "true"),
];

export const SETTINGS_SECTIONS: SettingSection[] = [
  {
    id: "terminal",
    title: "Terminal",
    fields: [
      pick("terminal.mode", "Terminal mode", ["touch", "chat", "agent"]),
      text("country.pack", "Country pack", undefined, "malaysia"),
      text("locale.language", "Language", "BCP-47 tag.", "en"),
      text("locale.currency", "Currency", "ISO 4217.", "MYR"),
      text("locale.money_locale", "Money locale", undefined, "en-MY"),
      text("locale.date_locale", "Date locale", undefined, "en-MY"),
      text("locale.clock_locale", "Clock locale", undefined, "en-US"),
      num("session.restart_ms", "Receipt countdown (ms)", undefined, "30000"),
      num("session.idle_ms", "Idle timeout (ms)", undefined, "60000"),
      num("session.verification_ttl_ms", "Verification validity (ms)", "How long a completed identity check stays valid.", "900000"),
    ],
  },
  {
    id: "llm",
    title: "LLM",
    note: "Document analysis, the chat assistant and the agent.",
    fields: [
      bool("llm.mock", "Mock the LLM", "Simulated verdicts — no model needed.", "true"),
      pick("llm.mock_verdict", "Mock verdict", ["match", "mismatch"], undefined, "match"),
      text("llm.base_url", "Base URL", "OpenAI-compatible endpoint; blank disables analysis."),
      text("llm.model", "Model", "As the gateway names it.", "llama3.2"),
      { key: "llm.api_key", label: "API key", kind: "secret", hint: "Sent as a Bearer token when set." },
      num("llm.timeout_ms", "Timeout (ms)", undefined, "30000"),
      num("llm.max_tokens", "Max tokens", undefined, "2048"),
      pick("llm.tool_call_shim", "Tool-call shim", ["auto", "off"], "Text-based tool calls for models without native support.", "auto"),
      { key: "llm.extra_body", label: "Extra request body", kind: "json", hint: "JSON merged into every request." },
      ...service("llm", "/models"),
    ],
  },
  {
    id: "ocr",
    title: "OCR",
    fields: [
      text("ocr.base_url", "Base URL", "Blank disables OCR."),
      num("ocr.timeout_ms", "Timeout (ms)", undefined, "60000"),
      num("ocr.dpi", "Rasterization DPI", undefined, "300"),
      ...service("ocr", "/healthcheck"),
    ],
  },
  {
    id: "face",
    title: "Face recognition",
    fields: [
      text("face.base_url", "Base URL", "Blank simulates the face scan."),
      bool("face.require_match", "Require a match", "A failed or unavailable match blocks verification.", "false"),
      num("face.min_similarity", "Minimum similarity", "Blank trusts the model's own threshold."),
      num("face.timeout_ms", "Timeout (ms)", undefined, "30000"),
      num("face.max_frame_bytes", "Max frame bytes", undefined, "8000000"),
      num("camera.timeout_ms", "Camera first-frame timeout (ms)", "How long the camera gets to produce a picture before the kiosk offers the way past it.", "12000"),
      ...service("face", "/healthcheck"),
    ],
  },
  {
    id: "stt",
    title: "Speech-to-text",
    fields: [
      text("voice.stt.base_url", "Base URL", "Blank hides the microphone."),
      text("voice.stt.language", "Language hint", undefined, "en"),
      bool("voice.stt.denoise", "Denoise", undefined, "false"),
      text("voice.stt.vocabulary", "Vocabulary", "Term=alias|alias;Term=alias"),
      num("voice.stt.timeout_ms", "Timeout (ms)", undefined, "60000"),
      ...service("voice.stt", "/../healthcheck"),
    ],
  },
  {
    id: "tts",
    title: "Text-to-speech",
    fields: [
      text("voice.tts.base_url", "Base URL", "Blank disables read-aloud."),
      text("voice.tts.voice", "Voice", "Kokoro voice id.", "af_heart"),
      num("voice.tts.speed", "Speed", undefined, "1.3"),
      pick("voice.tts.format", "Format", ["mp3", "wav", "opus", "flac", "pcm"], undefined, "mp3"),
      num("voice.tts.max_chars", "Max characters per request", undefined, "1500"),
      num("voice.tts.timeout_ms", "Timeout (ms)", undefined, "60000"),
      ...service("voice.tts", ""),
    ],
  },
  {
    id: "voice",
    title: "Voice behaviour",
    fields: [
      { key: "voice.languages", label: "Spoken languages", kind: "map", hint: "language=voice;language= — more than one turns on language detection." },
      bool("voice.hands_free", "Hands-free", undefined, "true"),
      bool("voice.read_aloud", "Read replies aloud", undefined, "true"),
      bool("voice.wait_for_speech", "Wait for speech to finish", undefined, "false"),
      bool("voice.barge_in", "Barge-in", "Speaking interrupts the narration.", "false"),
      num("voice.vad_silence_ms", "Utterance silence (ms)", undefined, "1200"),
      num("voice.vad_sensitivity", "VAD sensitivity", undefined, "2.5"),
    ],
  },
  {
    id: "agent",
    title: "Agent",
    fields: [
      text("agent.mcp_url", "MCP endpoint", undefined, "/api/mcp"),
      pick("agent.turns", "Planning", ["multi", "single"], "multi discovers steps by tool calls; single plans the whole path upfront.", "multi"),
      num("agent.max_steps", "Max tool steps per turn", undefined, "8"),
      { key: "agent.stop", label: "Extra stop sequences", kind: "list", hint: "Comma-separated." },
    ],
  },
  {
    id: "nfc",
    title: "ID card reader",
    fields: [
      pick("nfc.gesture", "On-screen gesture", ["insert", "tap"], undefined, "insert"),
      pick("nfc.driver", "Driver", ["pcsc", "mock"], undefined, "pcsc"),
      pick("nfc.simulate", "Simulate", ["auto", "always", "never"], "auto stands in when no reader answers.", "auto"),
      text("nfc.reader", "Reader", "Substring of the reader's name.", "first reader"),
      num("nfc.timeout_ms", "Card wait (ms)", undefined, "30000"),
      text("nfc.uid_command", "UID APDU", undefined, "FFCA000000"),
      pick("nfc.unknown_card", "Unknown cards", ["reject", "any"], undefined, "reject"),
      { key: "nfc.cards", label: "Card bindings", kind: "map", hint: "UID=citizen;UID=citizen — the registry's own bindings still apply." },
    ],
  },
  {
    id: "documents",
    title: "Documents",
    fields: [
      pick("documents.source", "Source", ["upload", "scanner", "mock"]),
      bool("documents.require_verification", "Require verification", "Documents must pass the OCR + LLM check.", "true"),
      bool("documents.single_document_per_capture", "One document per capture", undefined, "true"),
      num("documents.max_upload_bytes", "Max upload bytes", undefined, "10485760"),
      text("documents.mocks_dir", "Stand-in documents", "Folder the simulated scans come from."),
    ],
  },
  {
    id: "scanner",
    title: "Scanner",
    fields: [
      pick("documents.scanner.driver", "Driver", ["sane", "mock"], undefined, "sane"),
      pick("documents.scanner.profile", "Paper-detect profile", ["fi-800r", "none"], undefined, "fi-800r"),
      pick("documents.scanner.simulate", "Simulate", ["auto", "always", "never"], undefined, "auto"),
      text("documents.scanner.bin", "scanimage binary", undefined, "scanimage"),
      text("documents.scanner.device", "Device", "e.g. pfufs:fi-800R:003:004 or test:0", "first SANE device"),
      num("documents.scanner.resolution", "Resolution (dpi)", undefined, "300"),
      text("documents.scanner.mode", "Mode", undefined, "Color"),
      text("documents.scanner.source", "Source", undefined, "Adf-duplex"),
      text("documents.scanner.args", "Extra arguments"),
      num("documents.scanner.timeout_ms", "Scan timeout (ms)", undefined, "120000"),
      text("documents.scanner.status_bin", "Paper-detect tool", undefined, "pfufsgetscstatus"),
      text("documents.scanner.status_args", "Paper-detect arguments"),
      num("documents.scanner.wait_ms", "Wait for paper (ms)", "0 scans immediately.", "30000"),
      num("documents.scanner.poll_ms", "Paper poll (ms)", undefined, "2000"),
    ],
  },
  {
    id: "cms",
    title: "CMS & database",
    note: "The configured admin login follows this file on every start; a password changed inside /admin lasts until the next restart. The database settings are read on the next start — a value the adapter cannot open stops the kiosk from coming back up.",
    fields: [
      text("cms.admin_email", "Admin email", undefined, "admin@demo.local"),
      { key: "cms.admin_password", label: "Admin password", kind: "secret", hint: "Applied on restart." },
      { key: "cms.kiosk_key", label: "Kiosk API key", kind: "secret", hint: "Sent as x-kiosk-key by external REST callers.", placeholder: "dev-kiosk-key" },
      text("cms.database_url", "Database URL", "Where the registry lives. A relative file: path is resolved inside the kiosk's data directory.", "file:./db.sqlite"),
      text("cms.database_adapter", "Database adapter", "sqlite, postgres or mongodb; blank follows the URL scheme. Only sqlite ships with the kit — the rest need their Payload package installed first.", "sqlite"),
    ],
  },
  {
    id: "mock",
    title: "Demo timing & fees",
    fields: [
      text("mock.currency", "Currency", "Superseded by the locale currency when that is set.", "MYR"),
      num("mock.processing_fee", "Processing fee", undefined, "2"),
      num("mock.latency_ms", "Artificial latency (ms)", undefined, "900"),
      num("mock.identity.read_ms", "Simulated card read (ms)", undefined, "2800"),
      num("mock.identity.scan_ms", "Simulated scan (ms)", undefined, "2300"),
      num("mock.identity.citizen", "Simulated reader's citizen", "Registry citizen key; must match the stand-in documents.", "random"),
    ],
  },
];

export const SETTING_FIELDS: ReadonlyMap<string, SettingField> = new Map(
  SETTINGS_SECTIONS.flatMap((section) => section.fields.map((field) => [field.key, field])),
);
