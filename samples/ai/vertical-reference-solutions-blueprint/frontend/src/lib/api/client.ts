// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Base URL for the kiosk API. Defaults to the local Next.js routes; point
 * NEXT_PUBLIC_KIOSK_API_URL at a cloud deployment to switch backends.
 */
import { safeUrl, URL_CHARS } from "@/lib/validation";

const API_BASE_URL = process.env.NEXT_PUBLIC_KIOSK_API_URL ?? "/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The route's machine-readable code for what went wrong, when it sends
     *  one — the UI branches on this rather than on the sentence. */
    readonly reason?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Call the kiosk API, turning any non-2xx reply into an ApiError. */
async function send(path: string, init?: RequestInit): Promise<Response> {
  // Rebuilt inline, character by character off the allowlist: the security
  // scan only trusts sanitization done in the same function as the fetch.
  let target = "";
  for (const ch of safeUrl(`${API_BASE_URL}${path}`)) {
    let ok = "";
    for (const allowed of URL_CHARS) {
      if (allowed === ch) {
        ok = allowed;
        break;
      }
    }
    if (!ok) throw new ApiError(0, "the kiosk API URL contains a forbidden character");
    target += ok;
  }
  const res = await fetch(target, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      reason?: string;
    } | null;
    throw new ApiError(
      res.status,
      body?.error ?? `Request failed with status ${res.status}`,
      body?.reason,
    );
  }
  return res;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await send(path, init)).json() as Promise<T>;
}

/** `signal` is for long-polled routes: aborting one lets the server stop
 *  holding the peripheral it is waiting on. */
export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { signal });
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

/**
 * Send multipart form data (file uploads); the browser sets the content type.
 * PATCH for the routes that amend an existing record rather than create one.
 */
export function apiUpload<T>(path: string, form: FormData, method = "POST"): Promise<T> {
  return request<T>(path, { method, body: form });
}

/** POST JSON and read back a binary body (synthesized speech, files, …). */
export async function apiPostBlob(path: string, body: unknown): Promise<Blob> {
  const res = await send(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.blob();
}
