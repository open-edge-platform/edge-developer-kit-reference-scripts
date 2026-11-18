// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import type { TeleoperationEpisodeReviewV1 } from '@mujoco-studio/types';
import { LoaderCircle } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { API_PATH_CHARS, videoUrl } from './reviewUtils';

type ReviewCamera = TeleoperationEpisodeReviewV1['cameras'][number];

function CameraFrame({ camera, children }: { camera: ReviewCamera; children: ReactNode }) {
  return (
    <figure className="flex h-full min-w-0 flex-col overflow-hidden border border-border bg-black">
      <figcaption className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-raised px-2 py-1.5 text-[10px]">
        <span className="min-w-0 truncate font-medium text-foreground">{camera.name}</span>
        <span className="shrink-0 tabular-nums text-muted">
          {camera.width} x {camera.height}
        </span>
      </figcaption>
      <div className="relative grid min-h-0 w-full flex-1 place-items-center overflow-hidden">
        {children}
      </div>
    </figure>
  );
}

/**
 * Show one frame of a camera stored as an episode video: the video element seeks to the frame's
 * time instead of loading a separate image per frame.
 */
export function ReviewVideo({
  sourcePath,
  episodeId,
  framePosition,
  camera,
}: {
  sourcePath: string;
  episodeId: string;
  framePosition: number;
  camera: ReviewCamera;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const fps = camera.video.fps;
  let src = '';
  for (const character of videoUrl(sourcePath, episodeId, camera.name)) {
    let allowedCharacter = '';
    for (const allowed of API_PATH_CHARS) {
      if (allowed === character) {
        allowedCharacter = allowed;
        break;
      }
    }
    if (!allowedCharacter) {
      src = '';
      break;
    }
    src += allowedCharacter;
  }
  if (!src.startsWith('/') || src.startsWith('//')) src = '';

  useEffect(() => {
    const element = videoRef.current;
    if (!element || status !== 'ready') return;
    // Aim at the middle of the frame so rounding never lands on a neighboring frame.
    const time = (framePosition + 0.5) / fps;
    if (Math.abs(element.currentTime - time) > 0.25 / fps) element.currentTime = time;
  }, [fps, framePosition, status]);

  return (
    <CameraFrame camera={camera}>
      {status === 'loading' && (
        <LoaderCircle
          className="absolute animate-spin text-muted"
          aria-label={`Loading ${camera.name}`}
        />
      )}
      {status === 'failed' ? (
        <p className="absolute inset-0 grid place-items-center px-3 text-center text-[10px] text-danger">
          Video unavailable
        </p>
      ) : (
        <video
          ref={videoRef}
          aria-label={`${camera.name}, frame ${framePosition + 1}`}
          className="h-full w-full object-contain"
          data-recorded-camera={camera.name}
          height={camera.height}
          muted
          onError={() => setStatus('failed')}
          onLoadedData={() => setStatus('ready')}
          playsInline
          preload="auto"
          role="img"
          src={src || undefined}
          width={camera.width}
        />
      )}
    </CameraFrame>
  );
}
