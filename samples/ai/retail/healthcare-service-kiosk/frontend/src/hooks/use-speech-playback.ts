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

/** An utterance a sink is saying: how far through its text the voice is, 0–1,
 *  and whether it has finished — asked as often as the caption moves. */
export type SinkUtterance = { at: () => { progress: number; done: boolean } };

/**
 * Somewhere else for the voice to come out: the lip-synced avatar, whose
 * stream carries the speech with the video. While it is `ready` utterances go
 * to it; otherwise — or when it fails one — they play from the page.
 */
export type SpeechSink = {
  ready: boolean;
  /** Resolves once the utterance is being heard. */
  say: (text: string, language: string | undefined, signal: AbortSignal) => Promise<SinkUtterance>;
  /** Cut off whatever it is saying. */
  hush: () => void;
};

export function useSpeechPlayback(sink?: SpeechSink): SpeechPlayback {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Read inside `speak` so the callback identity never changes.
  const speakingIdRef = useRef<string | null>(null);
  // Bumped per request; a synthesis finishing after a newer one (or a stop) is dropped.
  const requestRef = useRef(0);
  const sinkRef = useRef(sink);
  useEffect(() => {
    sinkRef.current = sink;
  });
  /** The sink's utterance in flight: aborted, and the sink hushed, on stop. */
  const sinkAbortRef = useRef<AbortController | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const stopAudio = useCallback(() => {
    clearInterval(clockRef.current);
    const said = sinkAbortRef.current;
    if (said) {
      sinkAbortRef.current = null;
      said.abort();
      sinkRef.current?.hush();
    }
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

      const finish = () => {
        if (requestRef.current !== request) return;
        stopAudio();
        speakingIdRef.current = null;
        setSpeakingId(null);
        setProgress(0);
      };

      const playHere = () =>
        synthesizeSpeech(text, language)
          .then((audioBlob) => {
            if (requestRef.current !== request) return;
            const url = URL.createObjectURL(audioBlob);
            const audio = new Audio(url);
            audioRef.current = audio;
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

      const avatar = sinkRef.current;
      if (!avatar?.ready) {
        playHere();
        return;
      }
      const said = new AbortController();
      sinkAbortRef.current = said;
      avatar
        .say(text, language, said.signal)
        .then((utterance) => {
          if (requestRef.current !== request) return;
          setIsLoading(false);
          // The stream has no position to read: the sink keeps the clock.
          clockRef.current = setInterval(() => {
            const { progress, done } = utterance.at();
            if (done) {
              sinkAbortRef.current = null; // said in full: nothing to cut off
              finish();
            } else {
              setProgress(progress);
            }
          }, 100);
        })
        .catch(() => {
          if (requestRef.current !== request) return;
          sinkAbortRef.current = null;
          playHere();
        });
    },
    [stop, stopAudio],
  );

  useEffect(() => stopAudio, [stopAudio]);

  return { speakingId, isLoading, progress, speak, stop };
}
