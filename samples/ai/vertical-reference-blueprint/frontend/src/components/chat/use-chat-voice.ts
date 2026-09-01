// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KioskUIMessage } from "@/app/api/chat/route";
import { useServiceHealth } from "@/hooks/use-kiosk-api";
import { useSpeechPlayback, type SpeechPlayback } from "@/hooks/use-speech-playback";
import { useVoiceInput, type VoiceInput } from "@/hooks/use-voice-input";
import type { VoiceActivityOptions } from "@/lib/audio/voice-activity";
import { speakableText } from "./use-chat";

/**
 * The voice half of the assistant kiosk: a hands-free microphone, speaker
 * playback, and the narration mode that reads each reply aloud.
 *
 * Hands-free listening and read-aloud replies are both on out of the box, and
 * whether a kiosk has them is the deployment's call, not the citizen's: the
 * screen carries no voice switches to find. The mic holds itself open, voice
 * activity detection finds the start and end of each utterance, and the
 * recognized text is sent as a turn — a citizen can complete a service
 * without touching the screen. Listening is suspended whenever the kiosk is
 * speaking or working, so it never transcribes its own voice or talks over
 * itself.
 *
 * A deliberate tap (`dictation`) is treated differently from a hands-free
 * utterance: that text lands in the composer to be read back before sending,
 * because someone who reached for the button is asking to check their words.
 *
 * Availability comes from the same health poll the touch kiosk uses: with
 * speech-to-text down the mic is not offered, and with text-to-speech down
 * the kiosk simply stays quiet — the conversation still works by typing.
 */

/** Kiosks in loud halls can ship with hands-free off; the mic then waits for a tap. */
const HANDS_FREE_DEFAULT = process.env.NEXT_PUBLIC_KIOSK_HANDS_FREE !== "false";

/** Reading replies aloud is part of the kiosk out of the box — a citizen who
 *  is not looking at the screen still hears every question. A hall that wants
 *  quiet kiosks turns it off at install time, not per citizen. */
const NARRATE_DEFAULT = process.env.NEXT_PUBLIC_KIOSK_READ_ALOUD !== "false";

/** Let speech interrupt narration. This needs echo cancellation or sufficient
 *  distance between microphone and speaker, so it stays opt-in. */
const BARGE_IN_DEFAULT = process.env.NEXT_PUBLIC_KIOSK_BARGE_IN === "true";

/** Deployment tuning for the end-of-utterance pause and the speech threshold. */
const VAD_OPTIONS: VoiceActivityOptions = {
  ...(Number(process.env.NEXT_PUBLIC_KIOSK_VAD_SILENCE_MS) > 0
    ? { silenceMs: Number(process.env.NEXT_PUBLIC_KIOSK_VAD_SILENCE_MS) }
    : {}),
  ...(Number(process.env.NEXT_PUBLIC_KIOSK_VAD_SENSITIVITY) > 0
    ? { sensitivity: Number(process.env.NEXT_PUBLIC_KIOSK_VAD_SENSITIVITY) }
    : {}),
};

/**
 * Which voice reads a message aloud. Flow turns carry the pack's own words
 * whatever the citizen spoke, so they keep the default voice; only the free
 * LLM replies — no `data-flow` part — follow the citizen's language.
 */
export function narrationLanguage(
  message: KioskUIMessage | undefined,
  language: string,
): string | undefined {
  if (!message || message.parts.some((part) => part.type === "data-flow")) return undefined;
  return language;
}

/** What tapping the microphone does right now. */
export type MicIntent =
  /** Cut the utterance in progress short and send it to be recognized. */
  | "finish"
  /** Stop hands-free listening. */
  | "mute"
  /** Open the mic for one utterance, to be reviewed before sending. */
  | "dictate";

export type ChatVoice = {
  /** Speech-to-text is up: show the microphone. */
  canListen: boolean;
  /** Text-to-speech is up: show the speaker controls. */
  canSpeak: boolean;
  /** Language the citizen was last detected speaking. */
  language: string;
  input: VoiceInput;
  playback: SpeechPlayback;
  /** Mic open for every utterance, no tapping. */
  handsFree: boolean;
  setHandsFree: (on: boolean) => void;
  /** Listening is on but deliberately deaf — the kiosk is speaking or working. */
  paused: boolean;
  micIntent: MicIntent;
  onMicTap: () => void;
};

export function useChatVoice({
  messages,
  busy,
  blocked,
  language,
  onLanguage,
  onSend,
  onDraft,
}: {
  messages: KioskUIMessage[];
  busy: boolean;
  /** The citizen is mid physical step — a spoken turn would cut across it. */
  blocked?: boolean;
  /** The session's current language — the STT hint and the narration voice. */
  language: string;
  /** An utterance came back detected as a different supported language. */
  onLanguage: (language: string) => void;
  /** A hands-free utterance, sent as a turn on the citizen's behalf. */
  onSend: (text: string) => void;
  /** A dictated utterance, for the composer to show before it is sent. */
  onDraft: (text: string) => void;
}): ChatVoice {
  const { services } = useServiceHealth();
  const canListen = services?.stt === "ok";
  const canSpeak = services?.tts === "ok";

  const playback = useSpeechPlayback();
  const [handsFree, setHandsFree] = useState(HANDS_FREE_DEFAULT);
  const { speak, stop } = playback;

  // Deaf while the kiosk holds the floor: its own narration would otherwise
  // come straight back in as the citizen's next turn. Barge-in kiosks retain
  // speech detection during narration so voice activity can stop it.
  const paused =
    busy || Boolean(blocked) || (playback.speakingId !== null && !BARGE_IN_DEFAULT);

  const onTranscript = useCallback(
    (text: string, source: "hands-free" | "dictation", heard?: string) => {
      if (heard && heard !== language) onLanguage(heard);
      if (source === "hands-free") onSend(text);
      else onDraft(text);
    },
    [language, onLanguage, onSend, onDraft],
  );

  const input = useVoiceInput({
    listening: canListen && handsFree,
    paused,
    language,
    onTranscript,
    onSpeechStart: BARGE_IN_DEFAULT ? stop : undefined,
    vad: VAD_OPTIONS,
  });

  const micIntent: MicIntent = input.isSpeaking
    ? "finish"
    : input.isListening
      ? "mute"
      : "dictate";

  const onMicTap = useCallback(() => {
    if (micIntent === "finish") input.finishNow();
    else if (micIntent === "mute") setHandsFree(false);
    else input.dictate();
  }, [micIntent, input]);

  // The reply to narrate: the newest assistant message, once its turn has
  // finished streaming so the whole answer is read in one go.
  const lastReply = messages.findLast((message) => message.role !== "user");
  const replyId = lastReply?.id ?? null;
  const replyText = lastReply ? speakableText(lastReply) : "";
  const replyLanguage = narrationLanguage(lastReply, language);

  const narratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!NARRATE_DEFAULT || !canSpeak || busy) return;
    if (!replyId || !replyText || narratedRef.current === replyId) return;
    narratedRef.current = replyId;
    speak(replyId, replyText, replyLanguage);
  }, [canSpeak, busy, replyId, replyText, replyLanguage, speak]);

  // Restart wipes the transcript: cut playback so the old reply is not still
  // being read to the next citizen.
  useEffect(() => {
    if (messages.length > 0) return;
    narratedRef.current = null;
    stop();
  }, [messages.length, stop]);

  return {
    canListen,
    canSpeak,
    language,
    input,
    playback,
    handsFree,
    setHandsFree,
    paused,
    micIntent,
    onMicTap,
  };
}
