// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

const MOCK_LATENCY_MS = Number(process.env.KIOSK_MOCK_LATENCY_MS ?? 900);

/** Stands in for peripheral / network latency so the kiosk UI feels real. */
export function delay(ms = MOCK_LATENCY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * `extra` is for the machine-readable half of a refusal — a `reason` code the
 * caller can branch on. The sentence is for the citizen and changes freely;
 * the code is what the UI is allowed to make decisions with.
 */
export function notFound(message: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error: message, ...extra }, { status: 404 });
}

export function unavailable(message: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error: message, ...extra }, { status: 503 });
}

/** Parse a JSON body, treating a malformed one as an empty object. */
export async function readJson<T>(req: Request): Promise<Partial<T>> {
  return (await req.json().catch(() => ({}))) as Partial<T>;
}

/** A trimmed query-string value, or "" when absent. */
export function param(req: Request, name: string): string {
  return new URL(req.url).searchParams.get(name)?.trim() ?? "";
}

/**
 * Narrow an untrusted value to one of `allowed`, returning the rejection
 * response instead of the value when it doesn't match.
 */
export function oneOf<const T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  field: string,
): { ok: true; value: T[number] } | { ok: false; response: Response } {
  if (value && (allowed as readonly string[]).includes(value)) {
    return { ok: true, value: value as T[number] };
  }
  return { ok: false, response: badRequest(`${field} must be one of: ${allowed.join(", ")}`) };
}
