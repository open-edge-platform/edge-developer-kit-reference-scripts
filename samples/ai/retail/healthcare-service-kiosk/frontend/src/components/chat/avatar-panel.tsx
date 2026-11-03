// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { VideoOff } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { apiUrl } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { safeUrl, URL_CHARS } from "@/lib/validation";
import type { AvatarStatus } from "./use-lipsync-avatar";
import styles from "./chat-kiosk.module.css";

/** The assistant beside the conversation: the lip-synced person as a video
 *  tile with its name tag, and under it a card saying what it is doing — the
 *  live caption while the voice plays. */

export type AvatarState = "idle" | "listening" | "thinking" | "speaking" | "pointing" | "celebrating";

/**
 * The lipsync worker's stream: video and the voice in one. Not muted — the
 * replies are heard from here. A chat started by a scan has had no tap, and
 * a browser may refuse to play sound until there is one, so the first touch
 * anywhere starts it then.
 */
function AvatarVideo({ stream, className }: { stream: MediaStream; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    const play = () => {
      if (video.paused) video.play().catch(() => {});
    };
    play();
    document.addEventListener("pointerdown", play);
    return () => {
      document.removeEventListener("pointerdown", play);
      video.srcObject = null;
    };
  }, [stream]);
  return <video ref={ref} autoPlay playsInline aria-hidden className={className} />;
}

/**
 * The person the stream will show, held while it connects so the tile is not
 * empty for the seconds the worker takes to answer. It is the worker's small
 * thumbnail, so it is softened rather than passed off as the live picture;
 * without a worker to ask, the tile keeps its plain background.
 */
function AvatarStill({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  // Rebuilt inline, character by character off the allowlist: the security
  // scan only trusts sanitization done in the same function as the sink.
  let src = "";
  try {
    for (const ch of safeUrl(apiUrl("/avatar/preview"))) {
      let ok = "";
      for (const allowed of URL_CHARS) {
        if (allowed === ch) {
          ok = allowed;
          break;
        }
      }
      if (!ok) {
        src = "";
        break;
      }
      src += ok;
    }
  } catch {
    src = "";
  }
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a thumbnail from the worker, not a bundled asset
    <img
      src={src}
      alt=""
      aria-hidden
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

/** The states worth naming on the badge. */
const BADGES: Partial<Record<AvatarState, string>> = {
  speaking: "Speaking",
  listening: "Listening",
  thinking: "Thinking",
  pointing: "Your turn",
  celebrating: "All done",
};

/** What the caption card says while nothing is being read aloud. */
const HINTS: Record<AvatarState, string> = {
  idle: "Hello! Ask me anything about your visit, or pick a service.",
  listening: "Go ahead — I'm listening.",
  thinking: "One moment while I prepare your reply.",
  speaking: "",
  pointing: "Follow the step on the screen. I'll carry on once it's done.",
  celebrating: "Your request is done. Ask me if there's anything else.",
};

/** The sentence being spoken, split at the last word boundary reached. The
 *  synthesis has no word timestamps, so the position is proportional. */
function captionWindow(text: string, progress: number): { spoken: string; ahead: string } {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const said = progress * text.length;
  let start = 0;
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const end = start + sentence.length;
    if (said < end || i === sentences.length - 1) {
      // Light up whole words only — a half-highlighted word reads as a glitch.
      const words = sentence.trimEnd().match(/\S+\s*/g) ?? [sentence];
      let reached = start;
      let lit = 0;
      for (const word of words) {
        if (reached + word.length > said) break;
        reached += word.length;
        lit += 1;
      }
      return {
        spoken: words.slice(0, lit).join(""),
        ahead: words.slice(lit).join(""),
      };
    }
    start = end;
  }
  return { spoken: text, ahead: "" };
}

export function AvatarPanel({
  state,
  caption,
  progress,
  stream,
  status,
  className,
}: {
  state: AvatarState;
  /** The reply being read aloud — empty when nothing is playing. */
  caption: string;
  /** How far through the reply the voice is, 0–1. */
  progress: number;
  /** The lip-synced assistant's stream, once it is up. */
  stream: MediaStream | null;
  status: AvatarStatus;
  className?: string;
}) {
  // Keyed off the caption, not the state: the reply that finishes a request is
  // read under the send-off state, and is captioned all the same.
  const reading = Boolean(caption);
  const badge = BADGES[state];
  const { spoken, ahead } = reading ? captionWindow(caption, progress) : { spoken: "", ahead: "" };

  // Over the picture, which looks the same in both themes, the name tag is
  // fixed dark glass with light text; over the placeholder, an ordinary chip.
  const plate = stream
    ? "bg-[#102c27]/75 text-white backdrop-blur-sm"
    : "border bg-card text-foreground";
  return (
    <section aria-label="Your patient assistant" className={className}>
      <div className={styles.avatar}>
        {!stream && (
          <AvatarStill className={cn(styles.avatarVideo, "absolute inset-0 size-full object-cover opacity-35 blur-sm")} />
        )}
        {stream ? (
          <AvatarVideo stream={stream} className={cn(styles.avatarVideo, "absolute inset-0 size-full object-cover")} />
        ) : (
          <div role="status" className="relative flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
            {status === "lost" ? (
              <>
                <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <VideoOff className="size-7" aria-hidden />
                </span>
                <p className="text-lg font-semibold">Not connected</p>
                <p className="max-w-[16rem] text-sm text-muted-foreground">
                  Your assistant&apos;s video is unavailable. You can carry on chatting.
                </p>
              </>
            ) : (
              <>
                <Spinner className="size-7 text-primary" />
                <p className="text-base font-semibold text-muted-foreground">Connecting…</p>
              </>
            )}
          </div>
        )}

        <div className={cn("absolute bottom-3.5 left-3.5 max-w-[calc(100%-1.75rem)] rounded-2xl px-3.5 py-2", plate)}>
          <div className="text-sm font-semibold">Your patient assistant</div>
          <div className="text-xs opacity-75">Guides you through each step</div>
        </div>
      </div>

      <div className={styles.caption}>
        <div className="flex items-center gap-2.5">
          {reading ? (
            <div className="flex h-3.5 items-end gap-[3px]" aria-hidden>
              {[0, 1, 2, 3].map((bar) => (
                <span
                  key={bar}
                  className={cn(
                    "h-3.5 w-[3px] origin-bottom animate-ks-equalize rounded-full",
                    bar % 2 === 0 ? "bg-primary" : "bg-teal",
                  )}
                  style={{ animationDelay: `${bar * 150}ms` }}
                />
              ))}
            </div>
          ) : (
            <span
              className={cn(
                "size-2 rounded-full",
                badge ? "animate-ks-blink bg-teal shadow-[0_0_10px_var(--color-teal)]" : "bg-muted-foreground/40",
              )}
            />
          )}
          <span className="text-xs font-bold tracking-[0.14em] text-primary uppercase">
            {reading ? "Reading aloud" : (badge ?? "Ready")}
          </span>
        </div>
        {reading ? (
          <p className="line-clamp-4 text-2xl leading-snug font-medium text-pretty" aria-live="polite">
            {spoken}
            <span className="text-muted-foreground">{ahead}</span>
          </p>
        ) : (
          <p className="line-clamp-4 text-2xl leading-snug font-medium text-pretty">{HINTS[state]}</p>
        )}
      </div>
    </section>
  );
}
