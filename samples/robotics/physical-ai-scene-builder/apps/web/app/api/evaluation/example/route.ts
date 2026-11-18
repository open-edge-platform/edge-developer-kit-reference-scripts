// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { buildEvaluationExampleArchive } from '@/lib/evaluation/exampleArchive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const archive = await buildEvaluationExampleArchive();
    return new Response(archive, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'attachment; filename="evaluation-example.zip"',
        'Content-Length': String(archive.byteLength),
        'Content-Type': 'application/zip',
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'The evaluation example could not be built.',
      },
      { status: 500 },
    );
  }
}
