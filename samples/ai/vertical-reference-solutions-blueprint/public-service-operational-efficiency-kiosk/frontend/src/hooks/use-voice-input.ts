// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { openUtteranceRecorder, type UtteranceRecorder } from "@/lib/audio/utterance-recorder";
import type { VoiceActivityOptions } from "@/lib/audio/voice-activity";
import { transcribeSpeech } from "@/lib/api/kiosk";

/**
 * Microphone input for the kiosk. Voice activity detection decides where each
 * utterance begins and ends, so a citizen speaks and the text arrives — no
 * tapping to start or stop. The clip goes to /speech/transcribe and the
 * recognized text comes back through `onTranscript`.
 *
 * Two ways in, and the caller is told which one produced a transcript because
 * they carry different risk: `listening` keeps the mic open for every
 * utterance (hands-free), while `dictate()` opens it for exactly one.
 *
 * Nothing here throws. A missing microphone, a refused permission or a dead
 * service becomes a readable `error`, because the on-screen keyboard is
 * always there to fall back on.
 */
export type TranscriptSource = "hands-free" | "dictation";

export type VoiceInput = {
  /** The mic is open and watching for speech. */
  isListening: boolean;
  /** Speech is being captured right now. */
  isSpeaking: boolean;
  /** A finished utterance is being recognized. */
  isTranscribing: boolean;
  error: string | null;
  /** End the utterance in progress now instead of waiting for the pause. */
  finishNow: () => void;
  /** Open the mic for a single utterance. */
  dictate: () => void;
};

/** What went wrong opening the microphone, in words a citizen can act on. */
function micErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No microphone detected at this kiosk.";
    }
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      return "Microphone access was blocked. Allow it to speak to the kiosk.";
    }
  }
  return "The microphone could not be started.";
}

export function useVoiceInput({
  listening,
  paused,
  language,
  onTranscript,
  onSpeechStart,
  vad,
}: {
  /** Hands-free: hold the mic open and pick up every utterance. */
  listening: boolean;
  /** Keep the mic open but ignore it — the kiosk is speaking or working. */
  paused?: boolean;
  /** The session's current language, sent to the recognizer as its hint. */
  language?: string;
  onTranscript: (text: string, source: TranscriptSource, language?: string) => void;
  /** Voice activity began while the microphone was open. */
  onSpeechStart?: () => void;
  vad?: VoiceActivityOptions;
}): VoiceInput {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<UtteranceRecorder | null>(null);

  // Read by handlers that are created once when the mic opens, so they always
  // see the current value without tearing the recorder down and rebuilding it.
  const dictatingRef = useRef(dictating);
  const languageRef = useRef(language);
  const onTranscriptRef = useRef(onTranscript);
  const onSpeechStartRef = useRef(onSpeechStart);
  const vadRef = useRef(vad);
  useEffect(() => {
    dictatingRef.current = dictating;
    languageRef.current = language;
    onTranscriptRef.current = onTranscript;
    onSpeechStartRef.current = onSpeechStart;
    vadRef.current = vad;
  });

  const { mutate, isPending } = useMutation({
    mutationFn: ({ audio }: { audio: Blob; source: TranscriptSource }) =>
      transcribeSpeech(audio, undefined, languageRef.current),
    onSuccess: ({ text, language: heard }, { source }) => {
      if (!text) {
        setError("Nothing was picked up — please try again.");
        return;
      }
      setError(null);
      onTranscriptRef.current(text, source, heard);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const active = listening || dictating;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let opened: UtteranceRecorder | null = null;

    openUtteranceRecorder(
      {
        onSpeechStart: () => {
          setIsSpeaking(true);
          onSpeechStartRef.current?.();
        },
        onSpeechEnd: () => setIsSpeaking(false),
        onUtterance: (audio) => {
          const source: TranscriptSource = dictatingRef.current ? "dictation" : "hands-free";
          mutate({ audio, source });
          // One tap, one utterance — dictation closes the mic behind itself.
          if (source === "dictation") setDictating(false);
        },
      },
      vadRef.current,
    ).then(
      (recorder) => {
        // The permission prompt can outlive the intent that raised it.
        if (cancelled) {
          recorder.close();
          return;
        }
        opened = recorder;
        recorderRef.current = recorder;
        setError(null);
        setIsListening(true);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setError(micErrorMessage(cause));
        setDictating(false);
      },
    );

    return () => {
      cancelled = true;
      opened?.close();
      recorderRef.current = null;
      setIsListening(false);
      setIsSpeaking(false);
    };
  }, [active, mutate]);

  // Applied once the recorder exists, hence the isListening dependency.
  useEffect(() => {
    recorderRef.current?.setPaused(Boolean(paused));
  }, [paused, isListening]);

  const finishNow = useCallback(() => recorderRef.current?.finishNow(), []);
  const dictate = useCallback(() => {
    setError(null);
    setDictating(true);
  }, []);

  return { isListening, isSpeaking, isTranscribing: isPending, error, finishNow, dictate };
}
