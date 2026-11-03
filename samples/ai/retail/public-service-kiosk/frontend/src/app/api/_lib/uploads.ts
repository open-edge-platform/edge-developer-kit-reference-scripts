// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";

const exec = promisify(execFile);

/**
 * Storage for captured documents. Every document is a PDF — a picked file
 * already is one, and a scan is packed into one before it gets here (see
 * ./scanner) — so it is written into the uploads folder as it arrived and
 * downstream steps (OCR, analysis) read it back from disk.
 */
const UPLOADS_DIR = path.resolve(
  process.cwd(),
  process.env.KIOSK_UPLOADS_DIR ?? "../assets/pdf",
);

export type StoredDocument = {
  /** Original name of the uploaded file, for display. */
  fileName: string;
  /** Absolute path of the stored copy (for OCR / analysis). */
  filePath: string;
  title: string | null;
  pages: number;
  sizeKb: number;
  uploadedAt: string;
};

/* PDF literal strings escape ( ) and \ with a backslash. */
const LITERAL = "((?:\\\\.|[^\\\\)])*)";
const unescapePdf = (s: string) => s.replace(/\\([()\\])/g, "$1");

function extractTitle(bytes: Buffer): string | null {
  const raw = bytes.toString("latin1");
  const inline = raw.match(new RegExp(`/Title \\(${LITERAL}\\)`));
  if (inline) return unescapePdf(inline[1]);
  const ref = raw.match(/\/Title (\d+) 0 R/);
  if (ref) {
    const obj = raw.match(new RegExp(`(?:^|\\n)${ref[1]} 0 obj\\s*\\(${LITERAL}\\)`));
    if (obj) return unescapePdf(obj[1]);
  }
  return null;
}

function countPages(bytes: Buffer): number {
  const matches = bytes.toString("latin1").match(/\/Type \/Page[^s]/g);
  return matches?.length ?? 1;
}

/**
 * What a PDF says about itself, without writing it anywhere. The preview
 * shown before a capture is confirmed needs the same page count and size the
 * stored document will report, and it has nothing on disk to read them off.
 */
export function describePdf(bytes: Buffer): Pick<StoredDocument, "title" | "pages" | "sizeKb"> {
  return {
    // Title and page count are the PDF's own metadata — for a scan, the page
    // count is the number of sheets the citizen fed in.
    title: extractTitle(bytes),
    pages: countPages(bytes),
    sizeKb: Math.max(1, Math.round(bytes.length / 1024)),
  };
}

async function writeStored(
  serviceId: string,
  documentId: string,
  fileName: string,
  bytes: Buffer,
): Promise<StoredDocument> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const filePath = path.join(
    UPLOADS_DIR,
    `upload-${Date.now()}-${serviceId}-${documentId}.pdf`,
  );
  await writeFile(filePath, bytes);
  return {
    fileName,
    filePath,
    ...describePdf(bytes),
    uploadedAt: new Date().toISOString(),
  };
}

export async function storeDocument(
  serviceId: string,
  documentId: string,
  file: File,
): Promise<StoredDocument> {
  return writeStored(serviceId, documentId, file.name, Buffer.from(await file.arrayBuffer()));
}

/** Stores `sheets` (PDF page numbers, from 1) of `source` as a document of their own. */
export async function storeDocumentPages(
  serviceId: string,
  documentId: string,
  source: StoredDocument,
  sheets: number[],
): Promise<StoredDocument> {
  const dir = await mkdtemp(path.join(tmpdir(), "kiosk-split-"));
  try {
    const parts = sheets.map((sheet) => path.join(dir, `sheet-${sheet}.pdf`));
    for (const [index, sheet] of sheets.entries()) {
      await exec("pdfseparate", ["-f", String(sheet), "-l", String(sheet), source.filePath, parts[index]]);
    }
    const merged = path.join(dir, "document.pdf");
    await exec("pdfunite", [...parts, merged]);
    return await writeStored(serviceId, documentId, source.fileName, await readFile(merged));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function discardDocument(stored: StoredDocument): Promise<void> {
  await rm(stored.filePath, { force: true });
}
