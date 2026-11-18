// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  getVirtualSo101,
  startVirtualSo101,
  stopVirtualSo101,
  VirtualDeviceError,
} from '@/lib/virtualDevices/so101';
import { loopbackOrigin } from '@/lib/virtualDevices/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, fallback: string): Response {
  if (error instanceof VirtualDeviceError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}

export async function GET(): Promise<Response> {
  return Response.json({ device: getVirtualSo101() });
}

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return Response.json({ error: 'Expected a JSON request body.' }, { status: 400 });
    }
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      ('robot' in body && typeof body.robot !== 'string')
    ) {
      return Response.json({ error: 'Expected an optional robot name string.' }, { status: 400 });
    }
    const device = await startVirtualSo101({
      studioUrl: loopbackOrigin(request),
      robot: 'robot' in body && typeof body.robot === 'string' ? body.robot.trim() : undefined,
    });
    return Response.json({ device }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'The virtual SO-101 could not start.');
  }
}

export async function DELETE(): Promise<Response> {
  try {
    return Response.json({ device: await stopVirtualSo101() });
  } catch (error) {
    return errorResponse(error, 'The virtual SO-101 could not be stopped.');
  }
}
