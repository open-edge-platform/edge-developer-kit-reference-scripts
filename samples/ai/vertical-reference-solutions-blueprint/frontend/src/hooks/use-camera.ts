// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraStatus =
  /** Asking the browser for the device — the permission prompt may be up. */
  | "starting"
  /** Frames are flowing; the <video> element is showing the citizen. */
  | "live"
  /** The visitor (or a kiosk policy) refused the camera. */
  | "denied"
  /** No camera on this machine, the page is not on a secure origin, or the
   *  camera never produced a picture. */
  | "unavailable";

/**
 * How long the camera gets to produce its first frame before the kiosk gives
 * up on it.
 *
 * Both halves of the wait are genuinely unbounded without this. A
 * `getUserMedia` promise that is never settled — a permission prompt nobody
 * answers, a device the driver has wedged — leaves the hook on "starting" for
 * ever, and a camera that grants a stream but never delivers a picture (one
 * another application already holds, a capture card with nothing plugged into
 * it) leaves it there just as long. Neither raises an error, so nothing else
 * in the identity step ever hears about it: the citizen stands in front of
 * "Starting the camera…" with no frame, no failure and no way past.
 *
 * Giving up reports `unavailable`, which is a state the callers already know
 * how to handle — the touch step offers the camera-free check, the chat step
 * carries on without a frame — and "Try the camera again" is one tap away for
 * a machine that was only being slow.
 */
const FIRST_FRAME_TIMEOUT_MS = Number(
  process.env.NEXT_PUBLIC_KIOSK_CAMERA_TIMEOUT_MS ?? 12_000,
);

/**
 * The kiosk's front-facing camera, as a hook.
 *
 * `getUserMedia` only exists on a secure origin (https, or localhost during
 * development), so a kiosk served over plain http on a LAN address reports
 * `unavailable` rather than throwing — the identity step falls back to a
 * camera-free path in that case instead of dead-ending the citizen.
 *
 * The stream is stopped on unmount and whenever `enabled` goes false, which
 * matters more here than in a normal app: leaving the camera light on after a
 * citizen walks away from a public terminal is not acceptable.
 */
export function useCamera(enabled = true) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [opened, setOpened] = useState<CameraStatus>("starting");
  // Bumping this re-runs the request — the "Try again" after a denial.
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let track: MediaStream | null = null;
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;

    // Nothing below is guaranteed to happen — see FIRST_FRAME_TIMEOUT_MS — so
    // the deadline is armed before the request rather than after it resolves.
    const deadline = setTimeout(() => {
      if (cancelled) return;
      // Only a wait that is still a wait. A camera the visitor refused has
      // already said so, and "no camera on this kiosk" is the wrong thing to
      // tell somebody whose answer was "don't allow".
      setOpened((current) => (current === "starting" ? "unavailable" : current));
    }, FIRST_FRAME_TIMEOUT_MS);

    // A missing API is reported through the same rejection path as a refused
    // one, so every outcome lands in a callback rather than in the effect body.
    const request = media?.getUserMedia
      ? media.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        })
      : Promise.reject(new DOMException("no camera on this device", "NotFoundError"));

    request
      .then((next) => {
        track = next;
        if (cancelled) {
          next.getTracks().forEach((t) => t.stop());
          return;
        }
        // Deliberately NOT "live" yet: a resolved promise means the browser
        // handed over a stream, not that the stream carries a picture. The
        // <video> says when there is something to show, below.
        setStream(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const name = error instanceof Error ? error.name : "";
        setOpened(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      });

    return () => {
      cancelled = true;
      clearTimeout(deadline);
      track?.getTracks().forEach((t) => t.stop());
      setStream(null);
      setOpened("starting");
    };
  }, [enabled, attempt]);

  // Attaching in an effect (rather than when the promise resolves) means the
  // <video> can be rendered only once the stream exists — the ref is
  // guaranteed to be attached by the time this runs.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    // Autoplay of a muted, playsInline stream is allowed; a rejection here
    // just means the element was torn down mid-play.
    video.play().catch(() => {});

    // "live" is the element reporting a frame with real dimensions, which is
    // the only evidence there is anything to look at or to capture: a stream
    // whose track never produces one leaves the video at 0x0, and everything
    // downstream — the preview, `captureFrame` — has nothing to work with. If
    // the frame never arrives the deadline above calls it unavailable.
    const flowing = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) setOpened("live");
    };
    // Several events, because which one carries the first real frame differs
    // by browser for a MediaStream source — whichever arrives first wins, and
    // the rest are no-ops once the status is already live.
    const events = ["loadedmetadata", "loadeddata", "resize", "playing"] as const;
    flowing();
    events.forEach((event) => video.addEventListener(event, flowing));
    return () => {
      events.forEach((event) => video.removeEventListener(event, flowing));
      video.srcObject = null;
    };
  }, [stream]);

  // A switched-off camera reads as "starting" rather than as a failure: the
  // step that disabled it is not asking the citizen to fix anything.
  const status: CameraStatus = enabled ? opened : "starting";

  return { videoRef, status, live: status === "live", retry };
}
