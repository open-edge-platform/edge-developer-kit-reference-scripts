// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useId, useState } from "react";
import { Camera, CameraOff, Check, ScanFace } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useCamera, type CameraStatus } from "@/hooks/use-camera";
import { cn } from "@/lib/utils";

/**
 * Where the citizen is in the face check. The three states before `scanning`
 * exist purely for the person standing at the machine: a camera that snaps
 * the instant it opens gives them nothing to aim at, so the kiosk shows them
 * the frame, tells them where to stand, and only then starts matching.
 */
export type FacePhase = "starting" | "position" | "hold" | "scanning" | "verified" | "failed";

/** Caption shown over the viewport, and the line under it. */
const PHASE_COPY: Record<FacePhase, { caption: string; hint: string }> = {
  starting: { caption: "Starting the camera…", hint: "One moment, please." },
  position: {
    caption: "Position your face inside the oval",
    hint: "Stand about an arm's length from the screen, look straight ahead, and remove hats or sunglasses.",
  },
  hold: {
    caption: "That's it — hold still",
    hint: "Keep looking at the camera. This takes a couple of seconds.",
  },
  scanning: {
    caption: "Checking it's really you…",
    hint: "Matching your face against your ID document. Please keep still.",
  },
  verified: { caption: "Identity confirmed", hint: "Thank you — taking you to the next step." },
  failed: {
    caption: "We couldn't confirm your face",
    hint: "Step back into the oval and try again, or ask a staff member for help.",
  },
};

/** Ring / bracket colour per phase — the frame itself reports the state. */
const PHASE_ACCENT: Record<FacePhase, { stroke: string; border: string; chip: string }> = {
  starting: { stroke: "stroke-white/40", border: "border-white/40", chip: "bg-black/55 text-white" },
  position: { stroke: "stroke-cyan", border: "border-cyan", chip: "bg-black/60 text-white" },
  hold: { stroke: "stroke-cyan", border: "border-cyan", chip: "ks-gradient text-on-accent" },
  scanning: { stroke: "stroke-violet", border: "border-violet", chip: "ks-gradient text-on-accent" },
  verified: { stroke: "stroke-success", border: "border-success", chip: "bg-success text-white" },
  failed: {
    stroke: "stroke-destructive",
    border: "border-destructive",
    chip: "bg-destructive text-white",
  },
};

/**
 * The live camera viewport: the citizen's own picture, dimmed everywhere
 * except a head-and-shoulders oval they are asked to fill, with the frame
 * changing colour as the check progresses.
 *
 * Deliberately presentational — the phase is owned by whoever is running the
 * verification, so the same viewport serves the full-screen touch step and
 * the small inline card in the chat kiosk.
 */
export function FaceViewport({
  phase,
  videoRef,
  live,
  compact,
  className,
}: {
  phase: FacePhase;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Frames are actually flowing — otherwise a placeholder glyph is shown. */
  live: boolean;
  /** The small version used inline in the chat transcript. */
  compact?: boolean;
  className?: string;
}) {
  // Two viewports can be on screen at once (touch step + a chat card in a
  // dev split view), and a duplicated mask id would blank one of them out.
  const maskId = useId();
  const accent = PHASE_ACCENT[phase];
  const aligned = phase !== "starting" && phase !== "position";

  return (
    <div
      className={cn(
        "relative aspect-3/4 overflow-hidden rounded-[36px] border-2 bg-[#0b1220] transition-colors duration-500",
        accent.border,
        phase === "scanning" && "shadow-[0_0_60px_-12px_var(--color-violet)]",
        phase === "verified" && "shadow-[0_0_60px_-12px_var(--color-success)]",
        compact ? "w-44 rounded-3xl" : "w-72 lg:w-80",
        className,
      )}
    >
      {/* Mirrored, because a citizen adjusting their position against a
          non-mirrored image moves the wrong way every single time. */}
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        aria-label="Camera preview"
        className={cn(
          "size-full -scale-x-100 object-cover transition-opacity duration-500",
          live ? "opacity-100" : "opacity-0",
        )}
      />

      {!live && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/70">
          <ScanFace className={cn(compact ? "size-10" : "size-16")} strokeWidth={1.3} />
          {phase === "starting" && <Spinner className="size-6" />}
        </div>
      )}

      {/* Spotlight + alignment oval. The viewBox matches the 3:4 frame, so the
          oval lands in the same place whatever the rendered size is. */}
      <svg
        viewBox="0 0 300 400"
        className="pointer-events-none absolute inset-0 size-full"
        aria-hidden
      >
        <defs>
          <mask id={maskId}>
            <rect width="300" height="400" fill="white" />
            <ellipse cx="150" cy="182" rx="97" ry="126" fill="black" />
          </mask>
        </defs>
        <rect
          width="300"
          height="400"
          fill="rgba(6, 10, 22, 0.62)"
          mask={`url(#${maskId})`}
          className="transition-opacity duration-500"
          opacity={phase === "verified" ? 0.35 : 1}
        />
        {/* Head-and-shoulders guide: the oval for the face, plus the shoulder
            line that tells the citizen how far back to stand. */}
        <path
          d="M 34 400 Q 150 296 266 400"
          fill="none"
          strokeWidth={2}
          strokeDasharray="8 10"
          strokeLinecap="round"
          className={cn("opacity-45 transition-colors duration-500", accent.stroke)}
        />
        <ellipse
          cx="150"
          cy="182"
          rx="97"
          ry="126"
          fill="none"
          strokeWidth={aligned ? 4 : 3}
          strokeLinecap="round"
          strokeDasharray={aligned ? undefined : "16 14"}
          className={cn(
            "transition-all duration-500",
            accent.stroke,
            !aligned && "animate-ks-dash",
          )}
        />
      </svg>

      {/* Corner brackets close in once the citizen is framed — the "locked on"
          gesture every camera UI uses, doing the job of a sentence. */}
      <Brackets aligned={aligned} className={accent.border} compact={compact} />

      {phase === "scanning" && (
        <div className="pointer-events-none absolute inset-x-0">
          <div className="absolute inset-x-4 h-0.5 animate-ks-sweep rounded-full bg-linear-to-r from-transparent via-white to-transparent shadow-[0_0_22px_var(--color-cyan)]" />
        </div>
      )}

      {phase === "verified" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-success/25">
          <div
            className={cn(
              "flex animate-ks-pop items-center justify-center rounded-full bg-[image:var(--gradient-success)] shadow-[0_18px_50px_rgba(34,197,94,0.45)]",
              compact ? "size-16" : "size-24",
            )}
          >
            <Check
              className={cn(
                "animate-ks-draw text-white [stroke-dasharray:30] [stroke-dashoffset:30]",
                compact ? "size-9" : "size-13",
              )}
              strokeWidth={2.4}
            />
          </div>
        </div>
      )}

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex justify-center p-3",
          compact ? "p-2" : "p-4",
        )}
      >
        <div
          className={cn(
            "flex max-w-full items-center gap-2 rounded-full px-4 py-2 text-center font-semibold backdrop-blur-md transition-colors duration-500",
            accent.chip,
            compact ? "text-xs" : "text-base",
          )}
        >
          {phase === "scanning" || phase === "hold" ? (
            <WaitingDots />
          ) : phase === "verified" ? (
            <Check className={compact ? "size-3.5" : "size-5"} strokeWidth={2.6} />
          ) : phase === "failed" ? (
            <CameraOff className={compact ? "size-3.5" : "size-5"} />
          ) : (
            <Camera className={compact ? "size-3.5" : "size-5"} />
          )}
          {/* Deliberately terse even at full size: the long instruction is
              already spelled out beside the frame, and a caption that wraps
              or truncates over the citizen's own face reads as broken. */}
          <span className="truncate">{shortCaption(phase)}</span>
        </div>
      </div>
    </div>
  );
}

/** The chip has room for a handful of words at compact size. */
function shortCaption(phase: FacePhase): string {
  return {
    starting: "Starting camera…",
    position: "Face in the oval",
    hold: "Hold still",
    scanning: "Verifying…",
    verified: "Confirmed",
    failed: "Try again",
  }[phase];
}

function Brackets({
  aligned,
  className,
  compact,
}: {
  aligned: boolean;
  className: string;
  compact?: boolean;
}) {
  const corners = [
    "top-0 left-0 border-t-3 border-l-3 rounded-tl-xl",
    "top-0 right-0 border-t-3 border-r-3 rounded-tr-xl",
    "bottom-0 left-0 border-b-3 border-l-3 rounded-bl-xl",
    "bottom-0 right-0 border-b-3 border-r-3 rounded-br-xl",
  ];
  return (
    <div
      className={cn(
        "pointer-events-none absolute transition-all duration-700 ease-out",
        aligned ? "inset-[13%]" : "inset-[7%]",
      )}
    >
      {corners.map((corner) => (
        <span
          key={corner}
          className={cn(
            "absolute transition-colors duration-500",
            compact ? "size-5" : "size-9",
            corner,
            className,
          )}
        />
      ))}
    </div>
  );
}

/** Three hopping dots: "the machine is working, don't walk away". */
export function WaitingDots({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-1", className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-ks-dot rounded-full bg-current"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}

/** The instruction line that belongs with a phase, for use under the frame. */
export function facePhaseCopy(phase: FacePhase) {
  return PHASE_COPY[phase];
}

/**
 * Runs the citizen through the framing sequence and then fires `onCapture`
 * once, with the frame grabbed off the camera at that instant — the picture
 * the kiosk matches against the ID document. The caller owns everything after that (the match itself, the
 * verified hold, a failure), and reports it back through `outcome`.
 *
 * The `position` beat is real UX, not a fake loading bar: it is the window in
 * which somebody who has just walked up gets themselves into frame.
 */
/**
 * Longest edge of the frame sent for matching. The detectors behind the
 * face-recognition service work at 300x300 / 672x384, so a full 1280x960
 * capture is several times more pixels than the model can use — and the
 * difference is all upload latency the citizen spends standing still.
 */
const CAPTURE_MAX_EDGE = 640;

/** JPEG quality for the captured frame — enough detail for an embedding. */
const CAPTURE_QUALITY = 0.86;

/**
 * The current camera frame as a JPEG data URL, or null when there is nothing
 * to grab (no camera, or the stream has not produced a frame yet).
 *
 * The picture is taken from the stream, NOT from the mirrored `<video>` the
 * citizen sees: the mirroring is a CSS transform meant to make them move the
 * right way, and a flipped face is a different face to an embedding model.
 */
export function captureFrame(video: HTMLVideoElement | null): string | null {
  if (!video) return null;
  const { videoWidth: width, videoHeight: height } = video;
  if (!width || !height) return null;

  const scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", CAPTURE_QUALITY);
}

type Stage = "position" | "hold" | "captured";

export function useFaceScanSequence({
  enabled,
  paused,
  onCapture,
  outcome,
}: {
  enabled: boolean;
  /** Hold the sequence where it is — e.g. the kiosk is still talking. */
  paused?: boolean;
  /** Handed the captured JPEG data URL, or null if the frame could not be
   *  grabbed — the caller decides what an unverifiable capture means. */
  onCapture: (frame: string | null) => void;
  /** What the match did, once the caller knows. */
  outcome: "pending" | "verified" | "failed";
}) {
  const camera = useCamera(enabled);
  const cameraStatus: CameraStatus = camera.status;
  const live = camera.live;

  // The sequence restarts whenever the camera comes back up (a retry after a
  // denial, or the step being revisited), keyed on `live` so the reset happens
  // during render rather than in a second pass.
  const [session, setSession] = useState<{ live: boolean; stage: Stage }>({
    live,
    stage: "position",
  });
  if (session.live !== live) setSession({ live, stage: "position" });
  const stage = session.live === live ? session.stage : "position";
  const setStage = (next: Stage) => setSession({ live, stage: next });

  useEffect(() => {
    if (!live || paused || stage === "captured") return;
    const delay = stage === "position" ? 2_000 : 1_100;
    const timer = setTimeout(() => {
      if (stage === "position") {
        setStage("hold");
        return;
      }
      setStage("captured");
      onCapture(captureFrame(camera.videoRef.current));
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onCapture identity churns per render
  }, [live, paused, stage]);

  /** Put the citizen back at the framing beat, after a failed match. */
  const restart = () => setStage("position");

  /** Skip the framing beat — for the citizen who is already standing right. */
  const scanNow = () => {
    if (!live || paused || stage === "captured") return;
    setStage("captured");
    onCapture(captureFrame(camera.videoRef.current));
  };

  const phase: FacePhase =
    outcome === "verified"
      ? "verified"
      : outcome === "failed"
        ? "failed"
        : !live
          ? "starting"
          : stage === "captured"
            ? "scanning"
            : stage;

  return {
    phase,
    videoRef: camera.videoRef,
    live,
    cameraStatus,
    /** True once the camera is definitively not going to work. */
    blocked: cameraStatus === "denied" || cameraStatus === "unavailable",
    retryCamera: camera.retry,
    restart,
    scanNow,
    canSkip: live && stage !== "captured",
  };
}
