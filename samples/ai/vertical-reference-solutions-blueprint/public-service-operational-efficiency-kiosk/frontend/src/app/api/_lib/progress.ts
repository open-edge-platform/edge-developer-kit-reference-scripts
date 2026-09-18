// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Progress reporting for the two document operations that take long enough
 * for a citizen to think the kiosk has died: the scan itself, and the OCR →
 * LLM check that follows it. Both are a single HTTP request that answers only
 * when it is finished — a minute of nothing, and the one animation on screen
 * still saying "feed the document into the scanner" long after the scanner
 * pulled the page through.
 *
 * So the route reports which phase it is in as it goes, under the trace id
 * the client sent with the request, and the client reads that back from
 * `GET /api/documents/progress`. Polling rather than a streamed body on
 * purpose: the capture and confirm routes keep answering with plain JSON, so
 * nothing that already consumes them has to learn a new wire format.
 *
 * The store is in memory and per-process, which is all a kiosk is — one
 * machine, one citizen, one document at a time.
 */

/**
 * Where a capture has got to. The order here is the order they happen in,
 * and the UI reads it as such when it draws the bar.
 */
export const CAPTURE_PHASES = [
  /** Scanner mode: waiting for the citizen to put paper in the feeder. */
  "waiting",
  /** The scanner is pulling sheets through (or a file is being read). */
  "scanning",
  /** Sheets are being packed into the one PDF the rest of the kiosk takes. */
  "packing",
  /** The confirmed document is being written to the uploads folder. */
  "storing",
  /** OCR is reading the pages. */
  "reading",
  /** The model is deciding whether the sheets are one document or several. */
  "grouping",
  /** The model is ruling on the document against the citizen's identity. */
  "checking",
] as const;

export type CapturePhase = (typeof CAPTURE_PHASES)[number];

export type ProgressReport = {
  phase: CapturePhase;
  /** Page being read, for the OCR pass that walks a multi-sheet document. */
  page?: number;
  /** How many pages that pass has to get through. */
  pages?: number;
};

type Entry = ProgressReport & { at: number };

/** Nothing is worth reporting about a request that finished minutes ago. */
const TTL_MS = 5 * 60_000;
/**
 * A hard cap, because the trace id comes from the client: without it, anything
 * that could call the API could grow this map for as long as it liked.
 */
const MAX_TRACES = 32;

const reports = new Map<string, Entry>();

function sweep() {
  const stale = Date.now() - TTL_MS;
  for (const [id, entry] of reports) {
    if (entry.at < stale) reports.delete(id);
  }
  // Insertion order: the oldest trace is the first one out.
  while (reports.size > MAX_TRACES) {
    const oldest = reports.keys().next().value;
    if (oldest === undefined) break;
    reports.delete(oldest);
  }
}

export type Reporter = (phase: CapturePhase, detail?: Omit<ProgressReport, "phase">) => void;

/**
 * The reporter a route hands to the long-running work it kicks off. Requests
 * that sent no trace id get one that does nothing, so nothing downstream has
 * to care whether anybody is watching.
 */
export function reporter(traceId: unknown): Reporter {
  const id = typeof traceId === "string" ? traceId.trim().slice(0, 64) : "";
  if (!id) return () => {};
  return (phase, detail) => {
    reports.set(id, { phase, ...detail, at: Date.now() });
    sweep();
  };
}

/** The phase a trace is in, or null once it is finished or never started. */
export function readProgress(traceId: string): ProgressReport | null {
  const entry = reports.get(traceId);
  return entry ? { phase: entry.phase, page: entry.page, pages: entry.pages } : null;
}

/** Called when the request answers: there is nothing left to report. */
export function clearProgress(traceId: unknown): void {
  if (typeof traceId === "string" && traceId) reports.delete(traceId.trim().slice(0, 64));
}
