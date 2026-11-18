// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  checkGpuAvailability,
  getTrellisServiceState,
  refreshTrellisServiceState,
  startTrellisService,
  stopTrellisService,
} from '@/lib/process/trellisService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const [state, gpuAvailable] = await Promise.all([
    refreshTrellisServiceState(),
    checkGpuAvailability(),
  ]);
  return Response.json({ ...state, gpuAvailable });
}

export async function POST(): Promise<Response> {
  try {
    const [state, gpuAvailable] = await Promise.all([
      startTrellisService(),
      checkGpuAvailability(),
    ]);
    return Response.json({ ...state, gpuAvailable });
  } catch (error) {
    return Response.json(
      { errors: [{ message: error instanceof Error ? error.message : String(error) }] },
      { status: 503 },
    );
  }
}

/** Frees the TRELLIS.2 GPU memory on demand, without stopping the rest of the editor. */
export async function DELETE(): Promise<Response> {
  try {
    await stopTrellisService();
  } catch (error) {
    return Response.json(
      { errors: [{ message: error instanceof Error ? error.message : String(error) }] },
      { status: 409 },
    );
  }
  const [state, gpuAvailable] = await Promise.all([
    Promise.resolve(getTrellisServiceState()),
    checkGpuAvailability(),
  ]);
  return Response.json({ ...state, gpuAvailable });
}
