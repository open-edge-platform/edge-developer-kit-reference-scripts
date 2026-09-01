// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * In-process bridge onto the kiosk's own route handlers. The flow engine and
 * the MCP tools both reuse the HTTP routes as their single source of business
 * rules — a synthetic Request goes in, the parsed JSON body comes out, and no
 * network hop is involved.
 */

export type RouteHandler = (req: Request) => Response | Promise<Response>;

export type RouteResult = { ok: boolean; body: unknown };

/** Routes only read the query string and body, so the origin is arbitrary. */
const BASE_URL = "http://kiosk.internal/api";

export async function callRoute(
  handler: RouteHandler,
  init: {
    method?: "GET" | "POST" | "DELETE";
    params?: Record<string, string | undefined>;
    json?: unknown;
    form?: FormData;
  } = {},
): Promise<RouteResult> {
  const url = new URL(BASE_URL);
  for (const [key, value] of Object.entries(init.params ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  const request = new Request(url, {
    method: init.method ?? (init.json !== undefined || init.form ? "POST" : "GET"),
    ...(init.json !== undefined
      ? { body: JSON.stringify(init.json), headers: { "content-type": "application/json" } }
      : {}),
    ...(init.form ? { body: init.form } : {}),
  });
  const response = await handler(request);
  const body = await response
    .json()
    .catch(() => ({ error: `route returned HTTP ${response.status} with a non-JSON body` }));
  return { ok: response.ok, body };
}

/** The error message a failed route call carries, or a fallback. */
export function routeError(result: RouteResult, fallback: string): string {
  const body = result.body as { error?: string } | null;
  return body?.error || fallback;
}
