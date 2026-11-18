// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  getVirtualCameras,
  rememberStudioUrl,
  setVirtualCamera,
} from '@/lib/virtualDevices/cameras';
import { loopbackOrigin } from '@/lib/virtualDevices/origin';
import { VirtualDeviceError } from '@/lib/virtualDevices/so101';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  rememberStudioUrl(loopbackOrigin(request));
  return Response.json(await getVirtualCameras());
}

/** Turns a scene camera's virtual webcam on or off: `{name, enabled}`. */
export async function POST(request: Request): Promise<Response> {
  rememberStudioUrl(loopbackOrigin(request));
  try {
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      enabled?: unknown;
    } | null;
    return Response.json(await setVirtualCamera({ name: body?.name, enabled: body?.enabled }));
  } catch (error) {
    if (error instanceof VirtualDeviceError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : 'The camera could not be changed.' },
      { status: 500 },
    );
  }
}
