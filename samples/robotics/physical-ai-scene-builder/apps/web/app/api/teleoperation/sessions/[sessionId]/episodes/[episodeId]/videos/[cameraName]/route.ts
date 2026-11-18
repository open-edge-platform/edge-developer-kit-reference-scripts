// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import { TeleoperationReviewError } from '@/lib/teleoperation/reviewStore';
import {
  getTeleoperationEpisodeVideo,
  TeleoperationSessionError,
} from '@/lib/teleoperation/sessionManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ sessionId: string; episodeId: string; cameraName: string }>;
};

/** Parse a single `bytes=` range; browsers request ranges to seek within the video. */
function byteRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Math.min(Number(match[2]), size);
    return { start: size - suffix, end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return { start, end };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId, episodeId, cameraName } = await context.params;
    const video = await getTeleoperationEpisodeVideo(sessionId, episodeId, cameraName);
    const headers = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300, immutable',
      'Content-Type': video.contentType,
    };
    const range = byteRange(request.headers.get('range'), video.size);
    if (range && (range.start > range.end || range.start >= video.size)) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${video.size}` },
      });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? video.size - 1;
    const body = Readable.toWeb(
      createReadStream(video.path, { start, end }),
    ) as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        ...headers,
        'Content-Length': String(end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${video.size}` } : {}),
      },
    });
  } catch (error) {
    if (error instanceof TeleoperationSessionError || error instanceof TeleoperationReviewError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'The teleoperation video could not be loaded.',
      },
      { status: 500 },
    );
  }
}
