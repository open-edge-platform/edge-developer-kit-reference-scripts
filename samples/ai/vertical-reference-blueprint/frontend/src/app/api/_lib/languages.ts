// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { activePack } from "@/packs";
import { completeText } from "./llm";
import { systemPrompt } from "./prompts";

/**
 * The languages the assistant kiosk may follow a citizen into, from
 * `voice.languages` in config.yaml: `language code -> TTS voice`, an empty
 * voice meaning "narrate with the default voice". With more than one language
 * the chat pipeline detects which one each spoken turn is in and the reply,
 * the narration voice and the recognizer hint all follow it; with the setting
 * unset the kiosk is single-language and none of this runs.
 */
const CONFIGURED: ReadonlyMap<string, string> = new Map(
  (process.env.KIOSK_VOICE_LANGUAGES ?? "")
    .split(";")
    .map((entry) => entry.split("="))
    .filter((pair): pair is [string, ...string[]] => Boolean(pair[0]?.trim()))
    .map((pair) => [pair[0].trim(), pair[1]?.trim() ?? ""]),
);

/** The language the kiosk starts every session in — the recognizer's default hint. */
const DEFAULT_LANGUAGE = process.env.KIOSK_STT_LANGUAGE ?? activePack().locale.language;

export const defaultLanguage = () => DEFAULT_LANGUAGE;

export function chatLanguages(): string[] {
  return [...new Set([DEFAULT_LANGUAGE, ...CONFIGURED.keys()])];
}

export const detectionEnabled = () => chatLanguages().length > 1;

/** The tag itself when the kiosk speaks it, else the default language. */
export function supportedLanguage(language: unknown): string {
  return typeof language === "string" && chatLanguages().includes(language.trim())
    ? language.trim()
    : DEFAULT_LANGUAGE;
}

/** The configured voice for a language; undefined means the default voice. */
export function voiceForLanguage(language: string): string | undefined {
  return CONFIGURED.get(supportedLanguage(language)) || undefined;
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
 * Per-turn `{{language_instruction}}` override for the conversational
 * prompts. Empty for the default language so the pack's own value — which a
 * translated pack relies on — stays in charge there.
 */
export function languageInstruction(language: string | undefined): Record<string, string> {
  const chosen = supportedLanguage(language);
  if (chosen === DEFAULT_LANGUAGE) return {};
  return { language_instruction: `\nAlways reply in ${languageName(chosen)}.` };
}

/**
 * Which of the kiosk's languages `text` is written in. Falls back to
 * `current` whenever the answer is not one clean vote for a supported
 * language — the LLM mocked or down, an unusable reply, or a language the
 * kiosk does not speak — so a bad turn can never strand the session.
 */
export async function detectLanguage(text: string, current: string): Promise<string> {
  if (!detectionEnabled() || !text.trim()) return current;
  const options = chatLanguages()
    .map((code) => `${code} (${languageName(code)})`)
    .join(", ");
  const reply = await completeText(
    systemPrompt("detect-language"),
    `Languages this kiosk speaks: ${options}.\n\n` +
      `Transcript: "${text}"\n\n` +
      'Return {"language": "<code>"} — the language the transcript is written in, one of ' +
      `the codes above. If the transcript could be more than one of them, return "${current}".`,
  );
  const match = reply?.replace(/<think>[\s\S]*?<\/think>/g, "").match(/\{[\s\S]*?\}/);
  if (!match) return current;
  try {
    const detected = (JSON.parse(match[0]) as { language?: unknown }).language;
    return typeof detected === "string" && chatLanguages().includes(detected.trim())
      ? detected.trim()
      : current;
  } catch {
    return current;
  }
}
