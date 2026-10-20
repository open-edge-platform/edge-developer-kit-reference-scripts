// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { openSpeechStream, type SpeechStream } from "@/lib/audio/speech-stream";
import { openUtteranceRecorder } from "@/lib/audio/utterance-recorder";
import type { VoiceActivityOptions } from "@/lib/audio/voice-activity";
import { finishSpeech, speechStreamTarget, transcribeSpeech } from "@/lib/api/kiosk";

/**
 * Microphone input for the kiosk. Voice activity detection decides where each
 * utterance begins and ends, so a citizen speaks and the text arrives — no
 * tapping to start or stop.
 *
 * The microphone streams to the speech-to-text worker, whose own VAD cuts the
 * utterances and whose transcripts come back as they are recognized; the
 * kiosk server then settles each one's language and repairs its local terms
 * (/speech/transcript). A recognizer that cannot stream gets whole clips
 * instead: VAD in the browser cuts them and /speech/transcribe does the rest.
 * Either way the text arrives through `onTranscript`.
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
  const [streamTranscribing, setStreamTranscribing] = useState(false);
  const recorderRef = useRef<SpeechStream | null>(null);
  const orderRef = useRef<Promise<unknown>>(Promise.resolve());

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
    mutationFn: (
      input: { source: TranscriptSource } & ({ audio: Blob } | { text: string; language?: string }),
    ) => {
      const result =
        "audio" in input
          ? transcribeSpeech(input.audio, undefined, languageRef.current)
          : finishSpeech(input.text, languageRef.current, input.language);
      // Finished side by side, delivered in the order they were spoken: one
      // utterance's language check can take longer than the next one's.
      const ordered = orderRef.current.then(
        () => result,
        () => result,
      );
      orderRef.current = ordered.catch(() => undefined);
      return ordered;
    },
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
    let opened: SpeechStream | null = null;

    const onSpeechStart = () => {
      setIsSpeaking(true);
      onSpeechStartRef.current?.();
    };
    const onSpeechEnd = () => setIsSpeaking(false);
    /** Who an utterance belongs to; one tap, one utterance — dictation closes
     *  the mic behind itself. */
    const claim = (): TranscriptSource => {
      const source: TranscriptSource = dictatingRef.current ? "dictation" : "hands-free";
      if (source === "dictation") setDictating(false);
      return source;
    };

    const open = async (): Promise<SpeechStream> => {
      const target = await speechStreamTarget().catch(() => null);
      if (!target) {
        return openUtteranceRecorder(
          { onSpeechStart, onSpeechEnd, onUtterance: (audio) => mutate({ audio, source: claim() }) },
          vadRef.current,
        );
      }
      return openSpeechStream(target, speechStreamTarget, {
        onSpeechStart,
        onSpeechEnd,
        onTranscribing: setStreamTranscribing,
        onTranscript: (text, language) => {
          const source = claim();
          if (text) mutate({ text, language, source });
          else setError("Nothing was picked up — please try again.");
        },
        onError: setError,
      });
    };

    open().then(
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
      setStreamTranscribing(false);
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

  return {
    isListening,
    isSpeaking,
    isTranscribing: isPending || streamTranscribing,
    error,
    finishNow,
    dictate,
  };
}
