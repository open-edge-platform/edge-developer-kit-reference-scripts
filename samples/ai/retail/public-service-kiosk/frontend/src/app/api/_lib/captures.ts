// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";
import { describePdf } from "./uploads";

/**
 * Captured-but-not-yet-confirmed documents.
 *
 * A scan used to go straight from the feeder into the uploads folder and on
 * to the AI check, which meant the first thing the citizen saw of their own
 * document was a verdict on it — and if the sheet went in upside down, or the
 * feeder took two, they found out a minute later as a rejection with nothing
 * to compare it against. So a capture is held here instead, shown back to
 * them as pictures of the pages, and only stored and checked once they say
 * that is the document they meant to feed in.
 *
 * Held in memory rather than on disk: an unconfirmed capture is not a
 * document the kiosk has accepted, and it should leave no trace when the
 * citizen discards it or walks away.
 */

const exec = promisify(execFile);

export type HeldCapture = {
  id: string;
  serviceId: string;
  documentId: string;
  fileName: string;
  /** The capture as one PDF — the same bytes that will be stored on confirm. */
  bytes: Buffer;
  /** True when no scanner answered and a stand-in document was used. */
  simulated: boolean;
  at: number;
};

/** Long enough to read the preview and think about it; short enough to forget. */
const TTL_MS = 10 * 60_000;
/** One kiosk serves one citizen: more than a handful pending means a leak. */
const MAX_HELD = 8;

const held = new Map<string, HeldCapture>();

function sweep() {
  const stale = Date.now() - TTL_MS;
  for (const [id, capture] of held) {
    if (capture.at < stale) held.delete(id);
  }
  while (held.size > MAX_HELD) {
    const oldest = held.keys().next().value;
    if (oldest === undefined) break;
    held.delete(oldest);
  }
}

export function holdCapture(
  capture: Omit<HeldCapture, "id" | "at">,
): HeldCapture {
  const entry: HeldCapture = { ...capture, id: randomUUID(), at: Date.now() };
  held.set(entry.id, entry);
  sweep();
  return entry;
}

/**
 * The held capture, removed on the way out. Confirming is a one-shot: a
 * second confirm of the same id must not file the document twice.
 */
export function takeCapture(id: unknown): HeldCapture | null {
  if (typeof id !== "string" || !id) return null;
  const capture = held.get(id);
  if (capture) held.delete(id);
  return capture ?? null;
}

/** The citizen said this is not the document they wanted. */
export function dropCapture(id: unknown): boolean {
  return typeof id === "string" ? held.delete(id) : false;
}

/**
 * How many pages get pictures. A preview is there to answer "is this the
 * right paper, the right way up" — which the first few sheets settle — and
 * every page costs its own JPEG in the response body.
 */
const PREVIEW_PAGE_LIMIT = 6;
/** Wide enough to read a letterhead on a 15" kiosk panel, small enough to send. */
const PREVIEW_BOX_PX = "900";
const PREVIEW_QUALITY = "72";

/**
 * Pictures of the captured pages, as JPEG data URLs in page order.
 *
 * Rendered with `pdftoppm`, the same poppler tool the OCR step rasterizes
 * with, so a kiosk that can check documents can always preview them. An
 * install without it gets an empty list rather than a failed capture: the
 * preview is a courtesy, and losing it must not cost the citizen the scan
 * they just fed in.
 */
export async function previewPages(bytes: Buffer): Promise<string[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "kiosk-preview-"));
  try {
    const pdfPath = path.join(dir, "capture.pdf");
    await writeFile(pdfPath, bytes);
    await exec("pdftoppm", [
      "-jpeg",
      "-jpegopt",
      `quality=${PREVIEW_QUALITY}`,
      "-scale-to",
      PREVIEW_BOX_PX,
      "-f",
      "1",
      "-l",
      String(PREVIEW_PAGE_LIMIT),
      pdfPath,
      path.join(dir, "page"),
    ]);
    const names = (await readdir(dir)).filter((name) => name.endsWith(".jpg")).sort();
    const pages = await Promise.all(
      names.map((name) => readFile(path.join(dir, name))),
    );
    return pages.map((page) => `data:image/jpeg;base64,${page.toString("base64")}`);
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The preview payload the kiosk UI shows before anything is filed. */
export async function capturePreview(capture: HeldCapture) {
  const described = describePdf(capture.bytes);
  return {
    captureId: capture.id,
    documentId: capture.documentId,
    fileName: capture.fileName,
    ...described,
    capturedAt: new Date(capture.at).toISOString(),
    simulated: capture.simulated,
    previews: await previewPages(capture.bytes),
    /** Pages beyond `previews` exist but were not rendered — the UI says so. */
    previewLimit: PREVIEW_PAGE_LIMIT,
  };
}
