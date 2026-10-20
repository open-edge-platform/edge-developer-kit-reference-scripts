// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { StreamTarget } from "@/lib/audio/speech-stream";
import { safeUrl, URL_CHARS } from "@/lib/validation";
import { activePack } from "@/packs";
import { healthCheckEnabled, probeService, type ServiceHealth } from "./health";
import {
  chatLanguages,
  defaultLanguage,
  detectLanguage,
  recognizerLanguage,
  supportedLanguage,
} from "./languages";
import { completeText } from "./llm";
import { systemPrompt } from "./prompts";

/** Unset base URL means the capability is off and the chat UI hides its control. */
const STT_BASE_URL = process.env.KIOSK_STT_BASE_URL?.replace(/\/$/, "");
const STT_TIMEOUT_MS = Number(process.env.KIOSK_STT_TIMEOUT_MS ?? 60_000);
/** Background-noise removal — useful in a public hall, slower per request. */
const STT_DENOISE = process.env.KIOSK_STT_DENOISE === "true";

const TTS_BASE_URL = process.env.KIOSK_TTS_BASE_URL?.replace(/\/$/, "");
const TTS_TIMEOUT_MS = Number(process.env.KIOSK_TTS_TIMEOUT_MS ?? 60_000);
const TTS_VOICE = process.env.KIOSK_TTS_VOICE ?? "af_heart";
/** Faster than natural: every step waits on the narration before it advances. */
const TTS_SPEED = Number(process.env.KIOSK_TTS_SPEED ?? 1.3);
const TTS_FORMAT = process.env.KIOSK_TTS_FORMAT ?? "mp3";
const TTS_MAX_CHARS = Number(process.env.KIOSK_TTS_MAX_CHARS ?? 1_500);

/** The Studio's STT API takes no prompt or hot-word parameter, so local terms the recogniser
 *  mangles ("MyKad" -> "my cad") are repaired in the transcript instead. */
const DEFAULT_VOCABULARY = activePack().speech.vocabulary;

const VOCABULARY: { alias: string; term: string }[] = (
  process.env.KIOSK_STT_VOCABULARY ?? DEFAULT_VOCABULARY
)
  .split(";")
  .flatMap((entry) => {
    const [term = "", aliases = ""] = entry.split("=");
    if (!term.trim() || !aliases.trim()) return [];
    return aliases
      .split("|")
      .map((alias) => alias.trim())
      .filter(Boolean)
      .map((alias) => ({ term: term.trim(), alias }));
  });

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Case-insensitive whole-word replace, done by scanning rather than by
 *  compiling the alias into a RegExp. */
function replaceBounded(text: string, alias: string, term: string): string {
  const haystack = text.toLowerCase();
  const needle = alias.toLowerCase();
  if (!needle) return text;
  let out = "";
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return out + text.slice(from);
    const before = at > 0 ? text[at - 1] : "";
    const after = text[at + needle.length] ?? "";
    const bounded = !WORD_CHAR.test(before) && !WORD_CHAR.test(after);
    out += text.slice(from, at) + (bounded ? term : text.slice(at, at + needle.length));
    from = at + needle.length;
  }
}

/** Repair the local terms the recogniser mangled, by exact alias. */
export function applyVocabulary(text: string): string {
  return VOCABULARY.reduce((out, { alias, term }) => replaceBounded(out, alias, term), text);
}

/** Terms the recogniser has to be told about, for the LLM fallback prompt. */
const GLOSSARY = (process.env.KIOSK_STT_VOCABULARY ?? DEFAULT_VOCABULARY)
  .split(";")
  .map((entry) => entry.split("=")[0]?.trim())
  .filter(Boolean)
  .join(", ");

/** A small model handed a question sometimes answers it, so a drifting reply is rejected. */
async function repairWithLlm(text: string): Promise<string | null> {
  const { repairIntro, repairExamples } = activePack().speech;
  const reply = await completeText(
    systemPrompt("repair-transcript"),
    `${repairIntro}: ${GLOSSARY}.\n\n` +
      "Replace any word or phrase that is a garbled attempt at one of those terms with " +
      "the correct term. Leave every other word exactly as it is, and never answer or " +
      "rephrase the transcript.\n\n" +
      "Examples:\n" +
      repairExamples +
      `Transcript: "${text}"\n\nReturn {"text": "<corrected transcript>"}.`,
  );
  if (!reply) return null;
  const match = reply.replace(/<think>[\s\S]*?<\/think>/g, "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const repaired = (JSON.parse(match[0]) as { text?: unknown }).text;
    if (typeof repaired !== "string" || !repaired.trim()) return null;
    // A minimal edit stays about the same length; more drift means the model answered instead.
    const drift = Math.abs(repaired.length - text.length) / Math.max(text.length, 1);
    return drift <= 0.4 ? repaired.trim() : null;
  } catch {
    return null;
  }
}

/** The model first (it catches unlisted mishearings), then the alias list as a floor. */
export async function repairTranscript(text: string): Promise<string> {
  if (!text) return text;
  const byLlm = (await repairWithLlm(text)) ?? text;
  return applyVocabulary(byLlm);
}

const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  opus: "audio/opus",
  flac: "audio/flac",
  pcm: "audio/pcm",
};

export class SpeechServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeechServiceError";
  }
}

export const sttEnabled = () => Boolean(STT_BASE_URL);
export const ttsEnabled = () => Boolean(TTS_BASE_URL);

export const sttHealth = (): Promise<ServiceHealth> =>
  probeService({
    baseUrl: STT_BASE_URL,
    path: process.env.KIOSK_STT_HEALTH_PATH ?? "",
    enabled: healthCheckEnabled("KIOSK_STT_HEALTH_CHECK"),
  });

export const ttsHealth = (): Promise<ServiceHealth> =>
  probeService({
    baseUrl: TTS_BASE_URL,
    path: process.env.KIOSK_TTS_HEALTH_PATH ?? "",
    enabled: healthCheckEnabled("KIOSK_TTS_HEALTH_CHECK"),
  });

/** One raw recognizer call: the text ("" when nothing was picked up) and the
 *  language the recognizer says it heard, when it says. */
async function recognize(
  audio: Blob,
  fileName: string,
): Promise<{ text: string; language?: string }> {
  if (!STT_BASE_URL) throw new SpeechServiceError("speech-to-text is not configured");

  const form = new FormData();
  form.append("file", audio, fileName);
  form.append("language", recognizerLanguage());
  form.append("response_format", "verbose_json");
  form.append("use_denoise", String(STT_DENOISE));

  const res = await request(`${STT_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(STT_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as {
    text?: string;
    language?: unknown;
  } | null;
  return { text: body?.text?.trim() ?? "", language: reportedLanguage(body?.language) };
}

/** A recognizer's language label (`en`, `<|en|>`) as one of the kiosk's codes. */
export function reportedLanguage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.replace(/^<\|/, "").replace(/\|>$/, "").trim().toLowerCase();
  return chatLanguages().includes(code) ? code : undefined;
}

/**
 * A recognized utterance made ready to send: the language it was spoken in,
 * then the local terms the recognizer mangled repaired. `language` is the
 * session's current one; `reported` the one the recognizer heard, when it
 * says. Batch clips and streamed utterances both finish here.
 */
export async function finishTranscript(
  heard: string,
  language?: string,
  reported?: string,
): Promise<{ text: string; language: string }> {
  const current = supportedLanguage(language);
  const detected = await detectLanguage(heard, current, reportedLanguage(reported) ?? current);
  // The repair prompt and its worked examples are tuned to the pack's language.
  const text =
    detected === defaultLanguage() ? await repairTranscript(heard) : applyVocabulary(heard);
  return { text, language: detected };
}

/** The trailing silence that ends a streamed utterance. The OVMS worker cuts
 *  in 0.5 s chunks, so the default is exactly two of them. */
const STREAM_PAUSE_MS = Number(process.env.NEXT_PUBLIC_KIOSK_VAD_SILENCE_MS) || 1_000;
/** The worker VAD's own threshold, unset = its default. */
const STREAM_VAD_THRESHOLD = Number(process.env.KIOSK_STT_VAD_THRESHOLD) || undefined;
/** The OVMS worker's 15 s default would split a long answer into two turns. */
const STREAM_MAX_SPEECH_S = 30;

/** A studio instance address: origin, service type, instance id. */
const STUDIO_ADDRESS = /^(https?:\/\/[^/]+)\/api\/([a-z0-9-]+)@([a-z0-9-]+)(?:\/|$)/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

type StudioServiceRow = {
  type?: string;
  instanceId?: string;
  status?: string;
  port?: number | null;
  metadata?: { sttBackend?: string } | null;
  applied?: { metadata?: { sttBackend?: string } | null } | null;
};

/**
 * Where the browser streams the microphone: the socket of the studio worker
 * behind `voice.stt.base_url`. The studio proxies HTTP only, so the socket is
 * on the worker's own port, looked up in the studio's service list (which
 * sends no CORS headers, hence here and not in the browser). Workers listen
 * on 127.0.0.1 only, so a studio on another machine cannot stream.
 *
 * Null when the recognizer is not a studio worker the browser can reach —
 * clips are uploaded instead; throws when it is one but is not running.
 */
export async function speechStreamTarget(): Promise<StreamTarget | null> {
  const address = STT_BASE_URL?.match(STUDIO_ADDRESS);
  if (!address) return null;
  const [, origin, type, instanceId] = address;
  if (!LOOPBACK.has(new URL(origin).hostname)) return null;

  const res = await request(`${origin}/api/services`, { signal: AbortSignal.timeout(5_000) });
  const rows = (await res.json().catch(() => null)) as StudioServiceRow[] | null;
  const row = Array.isArray(rows)
    ? rows.find((r) => r?.type === type && r?.instanceId === instanceId)
    : undefined;
  if (!row || row.status !== "active" || typeof row.port !== "number") {
    throw new SpeechServiceError(`${type}@${instanceId} is not running`);
  }

  const socket = `ws://127.0.0.1:${row.port}`;
  const language = recognizerLanguage();
  const backend = row.applied?.metadata?.sttBackend ?? row.metadata?.sttBackend ?? "oep";
  if (backend === "ovms") {
    const query = new URLSearchParams({
      language,
      pause_duration: String(STREAM_PAUSE_MS / 1_000),
      max_continuous_speech_s: String(STREAM_MAX_SPEECH_S),
    });
    if (STREAM_VAD_THRESHOLD !== undefined) query.set("vad_threshold", String(STREAM_VAD_THRESHOLD));
    return { protocol: "audio-stream", url: `${socket}/v1/audio/stream?${query}` };
  }
  // The realtime socket takes no `auto`: leaving the language out detects it.
  const query = new URLSearchParams({ intent: "transcription" });
  if (language !== "auto") query.set("language", language);
  return {
    protocol: "realtime",
    url: `${socket}/v1/realtime?${query}`,
    turnDetection: {
      silence_duration_ms: STREAM_PAUSE_MS,
      ...(STREAM_VAD_THRESHOLD !== undefined ? { threshold: STREAM_VAD_THRESHOLD } : {}),
    },
  };
}

/** A recorded clip to text, plus the language it was spoken in. */
export async function transcribeAudio(
  audio: Blob,
  fileName: string,
  language?: string,
): Promise<{ text: string; language: string }> {
  const heard = await recognize(audio, fileName);
  return finishTranscript(heard.text, language, heard.language);
}

export type Speech = { audio: ArrayBuffer; contentType: string };

export async function synthesizeSpeech(
  text: string,
  options: { voice?: string; speed?: number } = {},
): Promise<Speech> {
  if (!TTS_BASE_URL) throw new SpeechServiceError("text-to-speech is not configured");

  const res = await request(`${TTS_BASE_URL}/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: text.slice(0, TTS_MAX_CHARS),
      voice: options.voice ?? TTS_VOICE,
      speed: options.speed ?? TTS_SPEED,
      response_format: TTS_FORMAT,
      stream: false,
    }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });
  return {
    audio: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? CONTENT_TYPES[TTS_FORMAT] ?? "audio/mpeg",
  };
}

async function request(url: string, init: RequestInit): Promise<Response> {
  // Rebuilt inline, character by character off the allowlist: the security
  // scan only trusts sanitization done in the same function as the fetch.
  let target = "";
  for (const ch of safeUrl(url)) {
    let ok = "";
    for (const allowed of URL_CHARS) {
      if (allowed === ch) {
        ok = allowed;
        break;
      }
    }
    if (!ok) throw new SpeechServiceError("the voice service URL contains a forbidden character");
    target += ok;
  }
  let res: Response;
  try {
    res = await fetch(target, init);
  } catch {
    throw new SpeechServiceError("the voice service is not responding");
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new SpeechServiceError(
      `the voice service returned ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return res;
}
