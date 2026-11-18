// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  clearVirtualSo101Calibration,
  uploadVirtualSo101Calibration,
  VirtualDeviceError,
} from '@/lib/virtualDevices/so101';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function failure(error: unknown, fallback: string): Response {
  if (error instanceof VirtualDeviceError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: fallback }, { status: 500 });
}

/** Uploads a calibration file: `{name, content}` where `content` is the file's JSON text. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      content?: unknown;
    } | null;
    const device = await uploadVirtualSo101Calibration({
      name: body?.name,
      content: body?.content,
    });
    return Response.json({ device });
  } catch (error) {
    return failure(error, 'The calibration could not be loaded.');
  }
}

/** Removes the uploaded calibration file and returns to the default calibration. */
export async function DELETE(): Promise<Response> {
  try {
    return Response.json({ device: await clearVirtualSo101Calibration() });
  } catch (error) {
    return failure(error, 'The calibration could not be cleared.');
  }
}
