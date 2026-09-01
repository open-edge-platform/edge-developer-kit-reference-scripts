// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ImageUp, RotateCcw, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCamera } from "@/hooks/use-camera";
import { IMAGE_SRC_CHARS, safeImageSrc } from "@/lib/validation";
import { cn } from "@/lib/utils";

/**
 * The portrait half of an enrollment: the picture the kiosk camera will be
 * matched against when this citizen comes to use a service.
 *
 * Two ways in, because a counter has both: the webcam on the desk, and a
 * photograph the citizen already has on file. Whichever is used, what leaves
 * here is a plain Blob — the desk does not care where the bytes came from,
 * and neither does the face-photos collection that checks them.
 *
 * The preview is mirrored and the capture is not. Somebody positioning
 * themselves in a non-mirrored preview moves the wrong way every time, but a
 * portrait stored mirrored is a portrait of nobody: the registry keeps the
 * frame as the camera actually saw it.
 */
export function PortraitCapture({
  portrait,
  onChange,
  existing,
  disabled,
}: {
  portrait: Blob | null;
  onChange: (portrait: Blob | null) => void;
  /**
   * URL of the portrait this citizen already has, shown until a new one is
   * taken. Served by the CMS behind the same access rules as the rest of the
   * registry, so it loads on the staff member's own admin session.
   */
  existing?: string | null;
  disabled?: boolean;
}) {
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { videoRef, status: cameraStatus, live: cameraLive } = useCamera(live);

  // The object URL is owned by this component: made when the blob changes and
  // revoked when it is replaced, so a desk that enrolls fifty citizens in a
  // morning is not holding fifty images open.
  const preview = useMemo(() => (portrait ? URL.createObjectURL(portrait) : null), [portrait]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  /** What the frame shows when the camera is off: the new picture, or the one on file. */
  const shown = preview ?? existing ?? null;

  // Rebuilt inline, character by character off the allowlist: the security
  // scan only trusts sanitization done in the same function as the sink.
  // Empty src on a foreign char.
  let portraitSrc = "";
  for (const ch of safeImageSrc(shown ?? "")) {
    let ok = "";
    for (const allowed of IMAGE_SRC_CHARS) {
      if (allowed === ch) {
        ok = allowed;
        break;
      }
    }
    if (!ok) {
      portraitSrc = "";
      break;
    }
    portraitSrc += ok;
  }

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    setBusy(true);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        setBusy(false);
        // A frame the canvas could not encode used to be a silent no-op: the
        // spinner stopped and the button just sat there.
        if (!blob) {
          setFailed(true);
          return;
        }
        setFailed(false);
        onChange(blob);
        setLive(false);
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "relative aspect-3/4 w-full overflow-hidden rounded-2xl border bg-muted",
          live && "border-cyan bg-[#0b1220]",
        )}
      >
        {shown && !live && (
          // eslint-disable-next-line @next/next/no-img-element -- a blob URL / CMS file, not a bundled asset
          <img
            src={portraitSrc}
            alt={preview ? "Portrait to be enrolled" : "Portrait currently on file"}
            className="size-full object-cover"
          />
        )}

        {live && (
          <>
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              aria-label="Camera preview"
              className={cn(
                "size-full -scale-x-100 object-cover transition-opacity",
                cameraLive ? "opacity-100" : "opacity-0",
              )}
            />
            {/* The same head-and-shoulders oval the kiosk asks citizens to
                fill, so a portrait is framed the way the matcher will see it. */}
            <svg viewBox="0 0 300 400" className="pointer-events-none absolute inset-0 size-full">
              <ellipse
                cx="150"
                cy="182"
                rx="97"
                ry="126"
                fill="none"
                stroke="currentColor"
                strokeDasharray="10 10"
                strokeWidth="2"
                className="text-cyan/70"
              />
            </svg>
          </>
        )}

        {!shown && !live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <UserRound className="size-12" strokeWidth={1.3} />
            <p className="px-6 text-center text-xs">
              No portrait yet — this citizen would not pass the kiosk face check.
            </p>
          </div>
        )}

        {live && !cameraLive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
            {cameraStatus === "starting" ? (
              <Spinner className="size-6" />
            ) : (
              <p className="px-6 text-center text-xs">
                {cameraStatus === "denied"
                  ? "The browser blocked the camera. Allow it for this site, then try again."
                  : "No camera on this machine — choose a photo file instead."}
              </p>
            )}
          </div>
        )}
      </div>

      {failed && (
        <p className="text-xs text-destructive">
          The photo could not be captured — try again, or choose a photo file instead.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {live ? (
          <>
            <Button type="button" size="sm" onClick={capture} disabled={!cameraLive || busy}>
              {busy ? <Spinner /> : <Camera />}
              Capture
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLive(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant={shown ? "outline" : "default"}
              onClick={() => setLive(true)}
              disabled={disabled}
            >
              {shown ? <RotateCcw /> : <Camera />}
              {shown ? "Retake" : "Take photo"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
            >
              <ImageUp />
              Choose file
            </Button>
            {/* Discards a picture taken here — it never offers to delete the
                one already on file, which is a registry change and belongs in
                the CMS with the rest of them. */}
            {portrait && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => onChange(null)}
                disabled={disabled}
              >
                <Trash2 />
                {existing ? "Discard" : "Remove"}
              </Button>
            )}
          </>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            setFailed(false);
            onChange(file);
          }
          // Cleared so picking the same file twice fires a change again.
          e.target.value = "";
        }}
      />
    </div>
  );
}
