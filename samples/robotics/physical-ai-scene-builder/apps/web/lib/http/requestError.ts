// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Client-side reading of API error responses. Routes answer `{ error: string }` and may add
// `issues: string[]` (validation problems). Worker start-up errors append the worker's last log
// lines after a newline. RequestError keeps the HTTP status and those lines so the UI can show
// them as a list instead of one run-on sentence.

export class RequestError extends Error {
  readonly status: number;
  readonly details: string[];
  readonly detailsLabel?: string;

  constructor(message: string, status: number, details: string[] = [], detailsLabel?: string) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.details = details;
    this.detailsLabel = detailsLabel;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses a JSON body without throwing on HTML error pages or empty bodies. */
export async function readJsonBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

/** Builds a RequestError from an already-parsed error body. */
export function requestErrorFromBody(
  body: unknown,
  status: number,
  fallback: string,
): RequestError {
  const raw =
    isRecord(body) && typeof body.error === 'string' && body.error ? body.error : fallback;
  const issues =
    isRecord(body) && Array.isArray(body.issues)
      ? body.issues.filter((issue): issue is string => typeof issue === 'string')
      : [];
  if (issues.length) return new RequestError(raw, status, issues, 'Problems');
  const [message, ...logLines] = raw.split('\n');
  const log = logLines.map((line) => line.trimEnd()).filter(Boolean);
  return log.length
    ? new RequestError(message, status, log, 'Worker log')
    : new RequestError(message, status);
}

/** Reads a failed response into a RequestError. */
export async function requestError(response: Response, fallback: string): Promise<RequestError> {
  return requestErrorFromBody(await readJsonBody(response), response.status, fallback);
}
