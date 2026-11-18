// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { runImageTo3d, trellisTimeoutMs } from '@/lib/process/imageTo3dPipeline';
import {
  IMAGE_TO_3D_PIPELINE_TYPES,
  imageTo3dImageError,
  type ImageTo3dEvent,
  type ImageTo3dPipelineType,
} from '@/lib/scenes/imageTo3dApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(message: string, status = 400): Response {
  return Response.json({ errors: [{ message }] }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse('Upload the image as multipart form data.');
  }
  const imageFile = form.get('image');
  const pipelineTypeField = form.get('pipelineType');
  const pipelineType = pipelineTypeField ?? '512';
  if (
    typeof pipelineType !== 'string' ||
    !IMAGE_TO_3D_PIPELINE_TYPES.some((value) => value === pipelineType)
  ) {
    return errorResponse('Choose a supported image-to-3D quality.');
  }

  if (!(imageFile instanceof File)) return errorResponse('Choose a PNG, JPEG, or WebP image.');
  const imageError = imageTo3dImageError(imageFile);
  if (imageError) return errorResponse(imageError);
  let timeoutMs: number;
  try {
    timeoutMs = trellisTimeoutMs();
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }

  const encoder = new TextEncoder();
  const cancelled = new AbortController();
  const signal = AbortSignal.any([request.signal, cancelled.signal]);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ImageTo3dEvent) => {
        if (!signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const result = await runImageTo3d({
          image: imageFile,
          pipelineType: pipelineType as ImageTo3dPipelineType,
          timeoutMs,
          signal,
          send,
        });
        send({ type: 'result', ...result });
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : 'The image could not be converted.',
        });
      } finally {
        if (!cancelled.signal.aborted) controller.close();
      }
    },
    cancel(reason) {
      cancelled.abort(reason);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
