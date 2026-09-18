// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Mic, MicOff, Square, Volume2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ChatVoice } from "./use-chat-voice";

/**
 * The voice affordances of the assistant kiosk, kept together so the chat
 * itself stays about the conversation: a live microphone beside the composer
 * and a listen button under each reply. Whether the kiosk listens and reads
 * replies aloud at all is a deployment setting, so there is nothing on screen
 * to switch on first.
 */

/** What the microphone is doing, as one word the button and status line share. */
type MicState = "transcribing" | "hearing" | "listening" | "paused" | "idle";

function micState(voice: ChatVoice): MicState {
  if (voice.input.isTranscribing) return "transcribing";
  if (voice.input.isSpeaking) return "hearing";
  if (!voice.input.isListening) return "idle";
  return voice.paused ? "paused" : "listening";
}

/** The line under the composer — with no button press to confirm, the citizen
 *  needs telling that the kiosk is listening and how to cut a sentence short. */
export function micStatusText(voice: ChatVoice): string | null {
  switch (micState(voice)) {
    case "transcribing":
      return "Working out what you said…";
    case "hearing":
      return "Listening — I'll stop when you pause, or tap to send now.";
    case "listening":
      return "Listening — just speak when you're ready.";
    case "paused":
      return "Microphone paused while the kiosk replies.";
    case "idle":
      return null;
  }
}

const LABELS: Record<MicState, string> = {
  transcribing: "Recognizing what you said",
  hearing: "Stop and send what I've said",
  listening: "Listening — stop listening",
  paused: "Microphone paused while the kiosk replies",
  idle: "Speak to the kiosk",
};

/**
 * Voice activity detection ends an utterance on its own, so this button is
 * never needed to start or stop a sentence — but it always offers the manual
 * way out: tap while speaking to send immediately, tap while idle to stop
 * listening, tap when off to dictate a single turn.
 */
export function MicButton({ voice, disabled }: { voice: ChatVoice; disabled?: boolean }) {
  const state = micState(voice);
  const label = LABELS[state];

  return (
    <button
      type="button"
      onClick={voice.onMicTap}
      disabled={disabled || state === "transcribing"}
      aria-label={label}
      title={label}
      className={cn(
        "relative flex size-13 shrink-0 cursor-pointer items-center justify-center rounded-2xl border transition-colors",
        "disabled:cursor-default disabled:opacity-50",
        state === "hearing" && "border-primary bg-primary/10 text-primary",
        state === "listening" && "border-primary/60 text-primary",
        state === "transcribing" && "text-primary",
        state === "paused" && "text-muted-foreground opacity-60",
        state === "idle" && "text-muted-foreground hover:border-ring hover:text-foreground",
      )}
    >
      {/* A live mic with no moving part looks identical to a dead one. */}
      {state === "listening" && (
        <span className="pointer-events-none absolute inset-0 animate-ping rounded-2xl border-2 border-primary/40" />
      )}
      {state === "transcribing" ? (
        <Spinner className="size-5" />
      ) : state === "hearing" ? (
        <Square className="size-5" fill="currentColor" />
      ) : state === "paused" ? (
        <MicOff className="size-5" />
      ) : (
        <Mic className="size-5" />
      )}
    </button>
  );
}

/** Reads one reply aloud; tapping again stops it. */
export function SpeakButton({
  voice,
  messageId,
  text,
  language,
}: {
  voice: ChatVoice;
  messageId: string;
  text: string;
  /** Voice to read with — see `narrationLanguage`; absent = default voice. */
  language?: string;
}) {
  const active = voice.playback.speakingId === messageId;
  const loading = active && voice.playback.isLoading;

  return (
    <button
      type="button"
      onClick={() => voice.playback.speak(messageId, text, language)}
      className={cn(
        "flex cursor-pointer items-center gap-2 self-start rounded-full border px-4 py-2 text-sm font-medium transition-colors hover:border-ring",
        active ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {loading ? (
        <Spinner className="size-4" />
      ) : active ? (
        <Square className="size-4" fill="currentColor" />
      ) : (
        <Volume2 className="size-4" />
      )}
      {active ? "Stop" : "Listen"}
    </button>
  );
}
