// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "child_process";
import { mkdtemp, readdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";
import { healthCheckEnabled, probeService, type ServiceHealth } from "./health";
import type { Reporter } from "./progress";

/**
 * Text extraction for captured documents. Every document is a PDF — a scan
 * is packed into one before it is stored — so it is rasterized with
 * `pdftoppm` (poppler-utils) into one image per page, and the pages go to the
 * OCR service at KIOSK_OCR_BASE_URL (e.g. a PaddleOCR worker's
 * `POST {base}/ocr`). If the service is not configured or unreachable,
 * extraction reports why — the document then counts as unverified rather than
 * as one that said nothing.
 */
const OCR_BASE_URL = process.env.KIOSK_OCR_BASE_URL?.replace(/\/$/, "");
const OCR_TIMEOUT_MS = Number(process.env.KIOSK_OCR_TIMEOUT_MS ?? 60_000);
const OCR_DPI = process.env.KIOSK_OCR_DPI ?? "300";
/** Probed for liveness; "" (the default) probes the base URL itself. */
const HEALTH_PATH = process.env.KIOSK_OCR_HEALTH_PATH ?? "";

const exec = promisify(execFile);

/** Reachability of the OCR service. See ./health for what the codes mean. */
export const ocrHealth = (): Promise<ServiceHealth> =>
  probeService({
    baseUrl: OCR_BASE_URL,
    path: HEALTH_PATH,
    enabled: healthCheckEnabled("KIOSK_OCR_HEALTH_CHECK"),
  });

/** Rasterize the PDF into per-page PNGs inside a temp dir. */
async function rasterize(pdfPath: string, dir: string): Promise<string[]> {
  await exec("pdftoppm", ["-r", OCR_DPI, "-png", pdfPath, path.join(dir, "page")]);
  const pages = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
  return pages.map((page) => path.join(dir, page));
}

/** OCR one page image via the OCR service (`POST {base}/ocr`). */
async function ocrPage(pagePath: string): Promise<string> {
  const bytes = await readFile(pagePath);
  const name = path.basename(pagePath);
  const form = new FormData();
  // Always a PNG: these are the pages `rasterize` just wrote.
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), name);
  const res = await fetch(`${OCR_BASE_URL}/ocr`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OCR service returned ${res.status}`);
  const body = (await res.json()) as { full_text?: string };
  return body.full_text ?? "";
}

/**
 * Why no text came back. The three cases have to stay distinct because they
 * mean different things to the citizen standing at the machine: "off" is an
 * install that never configured OCR, "failed" is a service that is down or
 * erroring, and "empty" is a page the OCR read but found no words on — a
 * blank sheet, or something fed in upside down.
 */
export type ExtractionFailure = "off" | "failed" | "empty";

export type TextExtraction =
  | {
      ok: true;
      /** Every page's text, joined — what the verification prompt reads. */
      text: string;
      /**
       * The same text, still split by sheet. Kept separate because a capture
       * is one PDF but not necessarily one document: a citizen who feeds two
       * different papers into the feeder gets both as pages of one file, and
       * a joined blob cannot be told apart from a genuine two-page statement.
       * Only the pages that carried text are here, so a blank separator sheet
       * does not read as a document of its own.
       */
      pages: string[];
    }
  | { ok: false; reason: ExtractionFailure };

const extracted = (raw: string[]): TextExtraction => {
  const pages = raw.map((page) => page.trim()).filter(Boolean);
  const text = pages.join("\n");
  return text ? { ok: true, text, pages } : { ok: false, reason: "empty" };
};

/**
 * Text of a captured document, OCR'd page by page via the OCR service. Every
 * page of the PDF is read and the text joined, because the pages of a
 * statement or a certificate only mean anything read together — and kept per
 * page as well, because whether they ARE one statement is the next question
 * asked of them (see `groupCapturedDocuments` in ./llm).
 *
 * A failure is reported rather than flattened into "no text": a document the
 * OCR service could not read is not a document that says nothing, and the
 * verification step must be able to tell the two apart before deciding
 * whether anyone may continue.
 */
export async function extractDocumentText(
  filePath: string,
  report: Reporter = () => {},
): Promise<TextExtraction> {
  if (!OCR_BASE_URL) return { ok: false, reason: "off" };
  const dir = await mkdtemp(path.join(tmpdir(), "kiosk-ocr-"));
  try {
    const pages = await rasterize(filePath, dir);
    const texts: string[] = [];
    for (const page of pages) {
      // Named page by page: OCR is the slowest part of the check, and "page 2
      // of 5" is the difference between a wait and a machine that has hung.
      report("reading", { page: texts.length + 1, pages: pages.length });
      texts.push(await ocrPage(page));
    }
    return extracted(texts);
  } catch {
    return { ok: false, reason: "failed" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
