// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { activePack } from "@/packs";

/**
 * The languages the assistant kiosk may follow a citizen into, from
 * `voice.languages` in config.yaml: `language code -> voice`. With more than
 * one language, Whisper says which one each utterance is in (speech.ts), and
 * the reply, the narration voice and the next turn all follow it; with the
 * setting unset the kiosk is single-language and none of this runs.
 *
 * A voice is a voice id on the `voice.tts` instance, or `voice@instance` for
 * one on another of the studio's text-to-speech instances (a base URL in
 * place of the instance works too). Left blank, the language gets its voice
 * from VOICES below, or `voice.tts.voice` when it has none there.
 */
const CONFIGURED: ReadonlyMap<string, string> = new Map(
  (process.env.KIOSK_VOICE_LANGUAGES ?? "")
    .split(";")
    .map((entry) => entry.split("="))
    .filter((pair): pair is [string, ...string[]] => Boolean(pair[0]?.trim()))
    .map((pair) => [pair[0].trim().toLowerCase(), pair.slice(1).join("=").trim()]),
);

/**
 * The studio voice each language speaks in when `voice.languages` names
 * none: Kokoro's for the eight languages it has, on `voice.tts` itself; the
 * others on the text-to-speech instance deployment.json starts for that
 * language, `text-to-speech-<code>`.
 */
const VOICES: Readonly<Record<string, { voice: string; instance?: string }>> = {
  en: { voice: "af_heart" },
  es: { voice: "ef_dora" },
  fr: { voice: "ff_siwis" },
  hi: { voice: "hf_alpha" },
  it: { voice: "if_sara" },
  ja: { voice: "jf_alpha" },
  pt: { voice: "pf_dora" },
  zh: { voice: "zf_xiaobei" },
  // Malaya (VITS)
  ms: { voice: "Shafiqah Idayu", instance: "text-to-speech-ms" },
  // Pocket TTS, Indonesian fine-tune
  id: { voice: "female_1", instance: "text-to-speech-id" },
  // VieNeu-TTS, northern accent
  vi: { voice: "Trúc Ly", instance: "text-to-speech-vi" },
  // Fastspeech2-HS
  ta: { voice: "tamil_female", instance: "text-to-speech-ta" },
};

/**
 * Languages Whisper confuses with a close one: it writes some Malay as
 * Indonesian (and the reverse), and on large-v3 some Mandarin with a
 * Cantonese accent as Cantonese. A kiosk that speaks only one of a pair
 * takes the other as it.
 */
const CLOSE: Readonly<Record<string, string>> = { id: "ms", ms: "id", yue: "zh" };

/** A code pins the recognizer to that language; `auto` (the default) lets Whisper detect each utterance's. */
const STT_LANGUAGE = process.env.KIOSK_STT_LANGUAGE?.trim().toLowerCase() || "auto";

/** The language the kiosk starts every session in. */
const DEFAULT_LANGUAGE =
  STT_LANGUAGE === "auto" ? activePack().locale.language : STT_LANGUAGE;

export const defaultLanguage = () => DEFAULT_LANGUAGE;

export function chatLanguages(): string[] {
  return [...new Set([DEFAULT_LANGUAGE, ...CONFIGURED.keys()])];
}

export const detectionEnabled = () => chatLanguages().length > 1;

/** What the recognizer is told to listen for: `auto` while there is a
 *  language to detect, else the one language the kiosk speaks. */
export const recognizerLanguage = () =>
  STT_LANGUAGE === "auto" && detectionEnabled() ? "auto" : DEFAULT_LANGUAGE;

/** The tag itself when the kiosk speaks it, else the default language. */
export function supportedLanguage(language: unknown): string {
  const code = typeof language === "string" ? language.trim().toLowerCase() : "";
  return chatLanguages().includes(code) ? code : DEFAULT_LANGUAGE;
}

const NAMES = new Intl.DisplayNames(["en"], { type: "language" });

/** English name of a language tag ("ms" -> "Malay"), for prompt text. */
export function languageName(language: string): string {
  try {
    return NAMES.of(language) ?? language;
  } catch {
    return language;
  }
}

/**
 * A recognizer's language label as a code: Whisper's own (`ms`, `<|ms|>`),
 * or the English name OpenAI's API gives (`malay`). A name of a language
 * the kiosk does not know comes back as is — still a language Whisper heard.
 */
export function languageCode(label: unknown): string | undefined {
  if (typeof label !== "string") return undefined;
  const value = label.trim().replace(/^<\|/, "").replace(/\|>$/, "").trim().toLowerCase();
  if (!value || value === "auto") return undefined;
  if (/^[a-z]{2,3}$/.test(value)) return value;
  const known = [...chatLanguages(), ...Object.keys(VOICES), ...Object.keys(CLOSE)];
  return known.find((code) => languageName(code).toLowerCase() === value) ?? value;
}

/** The kiosk language Whisper's detected one stands for: itself, a close one
 *  the kiosk speaks instead, or undefined when the kiosk speaks neither. */
export function kioskLanguage(heard: string | undefined): string | undefined {
  if (!heard) return undefined;
  if (chatLanguages().includes(heard)) return heard;
  const close = CLOSE[heard];
  return close && chatLanguages().includes(close) ? close : undefined;
}

/**
 * Who narrates in `language`: a voice id, and the text-to-speech instance
 * (id or base URL) it is on when that is not `voice.tts`. Empty for the
 * configured default voice.
 */
export function voiceFor(language: string | undefined): { voice?: string; instance?: string } {
  if (!language) return {};
  const chosen = supportedLanguage(language);
  const configured = CONFIGURED.get(chosen);
  if (configured) {
    const at = configured.indexOf("@");
    if (at === -1) return { voice: configured };
    return {
      voice: configured.slice(0, at).trim() || VOICES[chosen]?.voice,
      instance: configured.slice(at + 1).trim(),
    };
  }
  // The pack's own language keeps `voice.tts.voice`: the voice the touch screens narrate in.
  if (chosen === DEFAULT_LANGUAGE) return {};
  return VOICES[chosen] ?? {};
}

/**
 * Per-turn `{{language_instruction}}` override for the conversational
 * prompts. A translated pack's own value stays in charge of its default
 * language. Otherwise, on a kiosk that switches languages, the default one is
 * named too: left blank, a patient who switches back would get no
 * instruction, and the model would carry on in the language of the history.
 */
export function languageInstruction(language: string | undefined): Record<string, string> {
  const chosen = supportedLanguage(language);
  if (chosen === DEFAULT_LANGUAGE && (!detectionEnabled() || activePack().promptVars.language_instruction)) {
    return {};
  }
  return { language_instruction: `\nAlways reply in ${languageName(chosen)}.` };
}

/**
 * The turn's `[kiosk]` line naming its language, on a kiosk that switches
 * languages. The reply follows the patient's latest words, not their first.
 * A small model given only the system prompt keeps writing in the language
 * the history is in, so the language is named again where the turn ends.
 */
export function languageBriefing(language: string | undefined): string | undefined {
  if (!detectionEnabled()) return undefined;
  const name = languageName(supportedLanguage(language));
  return `The patient last spoke ${name}: write this reply in ${name}, even where earlier replies are in another language.`;
}
