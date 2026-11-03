// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { safeUrl, URL_CHARS } from "@/lib/validation";
import { activePack } from "@/packs";
import { healthCheckEnabled, probeService, type ServiceHealth } from "./health";
import {
  defaultLanguage,
  kioskLanguage,
  languageCode,
  recognizerLanguage,
  supportedLanguage,
  voiceFor,
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
/** The most of one reply that is read aloud. */
export const ttsMaxChars = () => TTS_MAX_CHARS;

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

/** The model first (it catches unlisted mishearings), then the alias list as
 *  a floor. An `aborted` request skips the model: nobody waits for the answer. */
export async function repairTranscript(text: string, aborted?: AbortSignal): Promise<string> {
  if (!text) return text;
  const byLlm = aborted?.aborted ? text : ((await repairWithLlm(text)) ?? text);
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

/**
 * One recognizer call, listening for `language` (`auto`: Whisper detects
 * it): the text ("" when nothing was picked up) and the language Whisper
 * says it heard. The studio's OEP backend says (in `verbose_json`); its
 * OVMS backend does not.
 */
async function recognize(
  audio: Blob,
  fileName: string,
  language: string,
  signal?: AbortSignal,
): Promise<{ text: string; heard?: string }> {
  if (!STT_BASE_URL) throw new SpeechServiceError("speech-to-text is not configured");

  const form = new FormData();
  form.append("file", audio, fileName);
  form.append("language", language);
  form.append("response_format", "verbose_json");
  form.append("use_denoise", String(STT_DENOISE));

  const timeout = AbortSignal.timeout(STT_TIMEOUT_MS);
  const res = await request(`${STT_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    body: form,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const body = (await res.json().catch(() => null)) as {
    text?: string;
    language?: unknown;
  } | null;
  return { text: body?.text?.trim() ?? "", heard: languageCode(body?.language) };
}

/**
 * An utterance to text, and the language it was spoken in — Whisper's call,
 * never the kiosk's own guess: the recognizer listens with `language=auto`
 * and says which language it heard.
 *
 * That language is the utterance's when the kiosk speaks it, or a close one
 * it speaks instead (Whisper writes some Malay as Indonesian). One the kiosk
 * does not speak is far more often Whisper picking wrong than a citizen
 * speaking it — short Malay comes back as Portuguese or Korean, Tamil as
 * Hindi, most of them in hall noise — so the utterance is transcribed again,
 * in the session's current `language`, and stays in it. A recognizer that
 * names no language (the OVMS backend) leaves the session's language as it
 * was. Then the local terms the recognizer mangled are repaired.
 *
 * `signal`: the browser's request; once it is gone (the citizen talked on
 * after the pause this was recognized at), the second pass and the repair
 * are skipped.
 */
export async function transcribeAudio(
  audio: Blob,
  fileName: string,
  language?: string,
  signal?: AbortSignal,
): Promise<{ text: string; language: string; heard?: string }> {
  const current = supportedLanguage(language);
  const listen = recognizerLanguage();
  const first = await recognize(audio, fileName, listen, signal);
  const heard = first.heard;
  let text = first.text;
  let spoken = listen === "auto" ? current : listen;
  if (listen === "auto" && heard) {
    const kiosk = kioskLanguage(heard);
    if (kiosk) spoken = kiosk;
    else if (text && !signal?.aborted) ({ text } = await recognize(audio, fileName, current, signal));
  }
  // The repair prompt and its worked examples are tuned to the pack's language.
  text = spoken === defaultLanguage() ? await repairTranscript(text, signal) : applyVocabulary(text);
  return { text, language: spoken, ...(heard ? { heard } : {}) };
}

export type Speech = { audio: ArrayBuffer; contentType: string };

/** A studio instance id: what follows `@` in its address. */
const INSTANCE_ID = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

/** The text-to-speech base URL for `instance` (languages.ts `voiceFor`): a base
 *  URL as given, or a studio instance id put in `voice.tts.base_url`'s address. */
function ttsBaseUrl(instance: string | undefined): string | undefined {
  if (!instance || !TTS_BASE_URL) return TTS_BASE_URL;
  if (/^https?:\/\//i.test(instance)) return instance.replace(/\/$/, "");
  if (!INSTANCE_ID.test(instance)) {
    throw new SpeechServiceError(`"${instance}" is neither a base URL nor a studio instance id`);
  }
  const address = /\/api\/text-to-speech@[a-z0-9-]+/;
  if (!address.test(TTS_BASE_URL)) {
    throw new SpeechServiceError(
      `voice.tts.base_url is not a studio instance address, so "${instance}" cannot be found next to it`,
    );
  }
  return TTS_BASE_URL.replace(address, `/api/text-to-speech@${instance}`);
}

/**
 * `language` picks the voice — and the instance it is on — that
 * `voice.languages` gives it (languages.ts `voiceFor`); `voice` overrides
 * that with one on `voice.tts`. `format` overrides the configured one — the
 * avatar takes WAV whatever the speakers get.
 */
export async function synthesizeSpeech(
  text: string,
  options: { language?: string; voice?: string; speed?: number; format?: string } = {},
): Promise<Speech> {
  if (!TTS_BASE_URL) throw new SpeechServiceError("text-to-speech is not configured");

  const chosen: { voice?: string; instance?: string } = options.voice
    ? { voice: options.voice }
    : voiceFor(options.language);
  const baseUrl = ttsBaseUrl(chosen.instance);
  const format = options.format ?? TTS_FORMAT;
  const res = await request(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: text.slice(0, TTS_MAX_CHARS),
      voice: chosen.voice ?? TTS_VOICE,
      speed: options.speed ?? TTS_SPEED,
      response_format: format,
      stream: false,
    }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });
  return {
    audio: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? CONTENT_TYPES[format] ?? "audio/mpeg",
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
