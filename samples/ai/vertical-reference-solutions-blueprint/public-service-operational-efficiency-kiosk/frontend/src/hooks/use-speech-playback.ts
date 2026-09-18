// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { synthesizeSpeech } from "@/lib/api/kiosk";

/** One utterance at a time: a new one cancels the current, and asking again
 *  for the one playing stops it, so a single button can toggle. */
export type SpeechPlayback = {
  /** Id of the utterance being synthesized or played, if any. */
  speakingId: string | null;
  /** The audio for `speakingId` has been requested but is not playing yet. */
  isLoading: boolean;
  /** Playback position, 0–1 — audio position; the synthesis has no word timestamps. */
  progress: number;
  /** `language` selects the voice configured for it; absent = default voice. */
  speak: (id: string, text: string, language?: string) => void;
  stop: () => void;
};

export function useSpeechPlayback(): SpeechPlayback {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Read inside `speak` so the callback identity never changes.
  const speakingIdRef = useRef<string | null>(null);
  // Bumped per request; a synthesis finishing after a newer one (or a stop) is dropped.
  const requestRef = useRef(0);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    URL.revokeObjectURL(audio.src);
    audioRef.current = null;
  }, []);

  const stop = useCallback(() => {
    requestRef.current += 1;
    stopAudio();
    speakingIdRef.current = null;
    setSpeakingId(null);
    setIsLoading(false);
    setProgress(0);
  }, [stopAudio]);

  const speak = useCallback(
    (id: string, text: string, language?: string) => {
      const wasSpeaking = speakingIdRef.current === id;
      stop();
      if (wasSpeaking || !text.trim()) return;

      const request = (requestRef.current += 1);
      speakingIdRef.current = id;
      setSpeakingId(id);
      setIsLoading(true);

      synthesizeSpeech(text, language)
        .then((audioBlob) => {
          if (requestRef.current !== request) return;
          const url = URL.createObjectURL(audioBlob);
          const audio = new Audio(url);
          audioRef.current = audio;
          const finish = () => {
            if (requestRef.current !== request) return;
            stopAudio();
            speakingIdRef.current = null;
            setSpeakingId(null);
            setProgress(0);
          };
          audio.onended = finish;
          audio.onerror = finish;
          audio.ontimeupdate = () => {
            if (requestRef.current !== request || !(audio.duration > 0)) return;
            setProgress(audio.currentTime / audio.duration);
          };
          setIsLoading(false);
          audio.play().catch(finish);
        })
        .catch(() => {
          // The kiosk stays usable without audio — drop back to the screen.
          if (requestRef.current === request) stop();
        });
    },
    [stop, stopAudio],
  );

  useEffect(() => stopAudio, [stopAudio]);

  return { speakingId, isLoading, progress, speak, stop };
}
