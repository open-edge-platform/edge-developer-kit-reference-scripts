// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SpeechSink } from "@/hooks/use-speech-playback";
import type { ServiceHealthStatus } from "@/lib/api/kiosk";
import { hushAvatar, openAvatar, sayThroughAvatar } from "./api";

/**
 * The assistant as a real person: the studio's lipsync worker streams a
 * person's video to the chat over WebRTC, idling until it is handed speech,
 * which it lip-syncs into the stream — the voice then comes out of the stream
 * with the lips, not out of the page.
 *
 * It is a `SpeechSink` for the playback hook: while the stream is up, replies
 * go to it; until it connects, or if it drops, they play from the page and
 * the panel says it is not connected. Negotiation goes through
 * the kiosk's own `/api/avatar/*` routes; the media flows straight between
 * this page and the worker, so the two must reach each other (on one box
 * they do, over the LAN address).
 */
export type LipsyncAvatar = SpeechSink & {
  /** The avatar's video and voice, once the stream is up. */
  stream: MediaStream | null;
  status: AvatarStatus;
};

export type AvatarStatus =
  /** This kiosk has no avatar (`voice.avatar` is not set). */
  | "off"
  | "connecting"
  | "live"
  /** Set up, but the worker is down or the stream would not connect. It keeps trying. */
  | "lost";

/** ICE on one machine gathers in milliseconds; a missing network must not hold the offer for long. */
const ICE_GATHER_MS = 3_000;
const RETRY_MS = 5_000;
/** A session that has not connected by now never will — ICE can sit in
 *  "checking" indefinitely after a network change — so it starts over. The
 *  worker answers a first offer in up to ~5 s while it loads the avatar. */
const CONNECT_MS = 15_000;
/** "disconnected" often comes back by itself (the path moves to another
 *  address); after this long it is given up on. */
const RECONNECT_GRACE_MS = 6_000;
/** From the worker taking an utterance to its first sound, until measured on
 *  the stream: 0.40–0.55 s for Wav2Lip at batch 1 on the NPU. */
const FIRST_LATENCY_S = 0.45;
/** RMS of the stream's audio that counts as the avatar talking. */
const ONSET_LEVEL = 0.01;
const ONSET_WAIT_S = 3;
/** An utterance counts as playing this long past its end: the stream delivers
 *  it late by a jitter buffer, and the mic must not reopen on its tail. */
const TAIL_MS = 300;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

function iceGathered(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const timer = setTimeout(() => resolve(), ICE_GATHER_MS);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState !== "complete") return;
      clearTimeout(timer);
      resolve();
    });
  });
}

/** `health`: the avatar in the health poll. The stream starts once that says
 *  the avatar is set up — "unreachable" too, which at boot is mostly a worker
 *  still loading: the attempts below retry every few seconds and so connect
 *  sooner than the next poll would notice it is up. It then stays until it
 *  fails by itself — one slow probe must not take the face away mid-reply. */
export function useLipsyncAvatar(health: ServiceHealthStatus | undefined): LipsyncAvatar {
  const configured = health === "ok" || health === "unreachable";
  const [wanted, setWanted] = useState(configured);
  if (configured && !wanted) setWanted(true);
  /** An attempt has failed since the stream was last up. */
  const [failed, setFailed] = useState(false);

  const [stream, setStream] = useState<MediaStream | null>(null);
  /** The stream is connected now. A dropped one keeps its last frame on show
   *  for the grace period, but nothing is said into it. */
  const [live, setLive] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const meterRef = useRef<{ context: AudioContext; analyser: AnalyserNode; samples: Float32Array<ArrayBuffer> } | null>(null);
  /** Seconds from handing over an utterance to hearing it, as last measured. */
  const latencyRef = useRef(FIRST_LATENCY_S);

  useEffect(() => {
    if (!wanted) return;
    let pc: RTCPeerConnection | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const drop = () => {
      clearTimeout(watchdog);
      sessionRef.current = null;
      meterRef.current?.context.close().catch(() => {});
      meterRef.current = null;
      setLive(false);
      setStream(null);
      const old = pc;
      pc = null;
      old?.close();
    };

    const again = (ms: number) => {
      setFailed(true);
      drop();
      clearTimeout(retry);
      if (!closed) retry = setTimeout(connect, ms);
    };

    /** Unless the session is connected within `ms`, start over. */
    const expect = (ms: number) => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (pc?.connectionState !== "connected") again(0);
      }, ms);
    };

    // A new network leaves a session that is not connected with nothing to
    // reach the worker by: start over on the new addresses straight away.
    const networkChanged = () => {
      if (pc?.connectionState !== "connected") again(0);
    };
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    window.addEventListener("online", networkChanged);
    connection?.addEventListener("change", networkChanged);

    // The stream's audio is metered, not played here — the video element plays it.
    const meter = (track: MediaStreamTrack) => {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
      meterRef.current = { context, analyser, samples: new Float32Array(analyser.fftSize) };
    };

    async function connect() {
      // One ICE transport for both tracks: the worker checks a bundle with one m-line's credentials.
      const peer = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
      pc = peer;
      // As the studio's own client offers it: video, then audio.
      peer.addTransceiver("video", { direction: "recvonly" });
      peer.addTransceiver("audio", { direction: "recvonly" });
      const media = new MediaStream();
      peer.ontrack = (event) => {
        media.addTrack(event.track);
        if (event.track.kind === "audio") meter(event.track);
      };
      peer.onconnectionstatechange = () => {
        if (pc !== peer) return;
        const state = peer.connectionState;
        if (state === "connected") {
          clearTimeout(watchdog);
          setStream(media);
          setLive(true);
          setFailed(false);
        } else if (state === "disconnected") {
          setLive(false);
          expect(RECONNECT_GRACE_MS);
        } else if (state === "failed" || state === "closed") {
          again(RETRY_MS);
        }
      };
      expect(CONNECT_MS);
      try {
        await peer.setLocalDescription(await peer.createOffer());
        await iceGathered(peer);
        // Read after gathering: it now carries the candidates.
        const offer = peer.localDescription;
        if (!offer) throw new Error("no local description");
        const answer = await openAvatar(offer);
        if (pc !== peer) return;
        sessionRef.current = answer.session_id;
        await peer.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
      } catch {
        if (pc === peer) again(RETRY_MS);
      }
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      window.removeEventListener("online", networkChanged);
      connection?.removeEventListener("change", networkChanged);
      drop();
    };
  }, [wanted]);

  const ready = live;
  const status: AvatarStatus = stream
    ? "live"
    : wanted
      ? failed
        ? "lost"
        : "connecting"
      : health === "off"
        ? "off"
        : "connecting";

  return useMemo<LipsyncAvatar>(() => {
    const level = () => {
      const meter = meterRef.current;
      if (!meter || meter.context.state !== "running") return null;
      meter.analyser.getFloatTimeDomainData(meter.samples);
      let sum = 0;
      for (const sample of meter.samples) sum += sample * sample;
      return Math.sqrt(sum / meter.samples.length);
    };

    /** Wait for the first sound after `posted`, and learn the latency from it;
     *  without a meter to listen with, wait the latency last learned. */
    const heard = async (posted: number, signal: AbortSignal) => {
      while (!signal.aborted) {
        const waited = (performance.now() - posted) / 1000;
        const now = level();
        if (now === null) return sleep(Math.max(0, latencyRef.current - waited) * 1000, signal);
        if (now > ONSET_LEVEL) {
          if (waited > 0.05) latencyRef.current = 0.7 * latencyRef.current + 0.3 * waited;
          return;
        }
        if (waited > ONSET_WAIT_S) return;
        await sleep(20, signal);
      }
      throw signal.reason;
    };

    const hush = () => {
      const session = sessionRef.current;
      if (session) hushAvatar(session).catch(() => {});
    };

    return {
      stream,
      status,
      ready,
      hush,
      say: async (text, language, signal) => {
        const session = sessionRef.current;
        if (!session) throw new Error("the avatar is not connected");
        // Created before any tap, the meter's context may still be suspended.
        await meterRef.current?.context.resume().catch(() => {});
        const pieces = sayThroughAvatar(session, text, language, signal);
        const first = await pieces.next();
        const posted = performance.now();
        // Stopped while the worker was being handed it: take it back.
        if (signal.aborted) {
          hush();
          throw signal.reason;
        }
        if (first.done) throw new Error("the avatar was given nothing to say");

        // The rest arrive while the first is said; each is heard after the one
        // before, and no sooner than a latency after the worker took it.
        const said = [{ ...first.value, taken: posted }];
        let complete = false;
        (async () => {
          for await (const piece of pieces) said.push({ ...piece, taken: performance.now() });
        })()
          .catch(() => {})
          .finally(() => {
            complete = true;
          });

        await heard(posted, signal);
        const startedAt = performance.now();
        return {
          at: () => {
            const now = performance.now();
            let end = startedAt;
            let chars = 0;
            for (const [index, piece] of said.entries()) {
              // The first was heard at `startedAt`; the others are placed by the latency.
              const start = index === 0 ? startedAt : Math.max(end, piece.taken + latencyRef.current * 1000);
              const seconds = Math.max(piece.seconds, 0.1);
              if (now < start + seconds * 1000) {
                const into = Math.max(0, now - start) / 1000 / seconds;
                return { progress: Math.min((chars + piece.text.length * into) / text.length, 1), done: false };
              }
              end = start + seconds * 1000;
              chars += piece.text.length;
            }
            return { progress: complete ? 1 : chars / text.length, done: complete && now >= end + TAIL_MS };
          },
        };
      },
    };
  }, [stream, status, ready]);
}
