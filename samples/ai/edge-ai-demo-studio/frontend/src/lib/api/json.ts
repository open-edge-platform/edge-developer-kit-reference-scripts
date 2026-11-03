// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** API route helpers: every error answers `{ error: string }`, where `fetchJson` looks for it. */

import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { logger } from '@/lib/logger'

export type ErrorBody = { error: string } & Record<string, unknown>

/** `{ error }` with `status`; `extra` fields ride along (e.g. `addresses`). */
export function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
): NextResponse<ErrorBody> {
  return NextResponse.json({ ...extra, error }, { status })
}

/** An `ApiError` answers with its own status; anything else is logged and answers 500 `fallback`. */
export function jsonErrorFrom(
  error: unknown,
  fallback: string,
  context = fallback,
): NextResponse<ErrorBody> {
  if (error instanceof ApiError) return jsonError(error.status, error.message)
  logger.error(`${context}:`, error)
  return jsonError(500, fallback)
}

/** One line naming every problem zod found: `hfToken: Expected string`. */
function describeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join('.')}: ${issue.message}`
        : issue.message,
    )
    .join('; ')
}

export type ParsedBody<T> =
  { ok: true; data: T } | { ok: false; response: NextResponse<ErrorBody> }

/** Parses and validates the JSON body; malformed or mismatched bodies answer 400. */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<ParsedBody<z.output<S>>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { ok: false, response: jsonError(400, 'Invalid JSON body') }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      response: jsonError(400, describeZodError(parsed.error)),
    }
  }
  return { ok: true, data: parsed.data }
}
