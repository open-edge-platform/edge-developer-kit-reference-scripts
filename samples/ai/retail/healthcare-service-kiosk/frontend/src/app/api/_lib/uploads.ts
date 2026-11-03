// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from "crypto";
import { mkdir, readdir, rm, writeFile } from "fs/promises";
import path from "path";
import PDFDocument from "pdfkit";
import { isImageDocument } from "./media";

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

/** `openImage` reads a JPEG's or PNG's pixel size; @types/pdfkit does not declare it. */
type ImageReader = { openImage(src: Buffer): { width: number; height: number } };

/** A photo of a report, or an image of a scan, as a one-page PDF sized to it (at 300 dpi). */
export function imageToPdf(image: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    try {
      const { width, height } = (pdf as unknown as ImageReader).openImage(image);
      const scale = 72 / 300;
      pdf.addPage({ size: [width * scale, height * scale], margin: 0 });
      pdf.image(image, 0, 0, { width: width * scale, height: height * scale });
      pdf.end();
    } catch (error) {
      reject(error);
    }
  });
}

/** The bytes as stored: a PDF as it came, an image wrapped into one. */
export async function documentBytes(fileName: string, bytes: Buffer): Promise<Buffer> {
  return isImageDocument(fileName) ? imageToPdf(bytes) : bytes;
}

export async function storeDocument(
  serviceId: string,
  documentId: string,
  file: File,
): Promise<StoredDocument> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const bytes = await documentBytes(file.name, Buffer.from(await file.arrayBuffer()));
  const filePath = path.join(
    UPLOADS_DIR,
    `upload-${Date.now()}-${serviceId}-${documentId}.pdf`,
  );
  await writeFile(filePath, bytes);
  return {
    fileName: file.name,
    filePath,
    ...describePdf(bytes),
    uploadedAt: new Date().toISOString(),
  };
}

/** A page read only to find a record: stored beside the captures for as long as `read` runs, then deleted. */
export async function withStoredPage<T>(bytes: Buffer, read: (filePath: string) => Promise<T>): Promise<T> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const filePath = path.join(UPLOADS_DIR, `identity-${Date.now()}-${randomUUID()}.pdf`);
  await writeFile(filePath, bytes);
  try {
    return await read(filePath);
  } finally {
    await rm(filePath, { force: true });
  }
}

/** The stored copy of a document filed at `uploadedAt`: its file name carries the moment it was written. */
export async function findStoredDocument(
  serviceId: string,
  documentId: string,
  uploadedAt: string,
): Promise<string | null> {
  const filedAt = Date.parse(uploadedAt);
  if (Number.isNaN(filedAt)) return null;
  const suffix = `-${serviceId}-${documentId}.pdf`;
  let best: { at: number; name: string } | null = null;
  for (const name of await readdir(UPLOADS_DIR).catch(() => [] as string[])) {
    if (!name.startsWith("upload-") || !name.endsWith(suffix)) continue;
    const at = Number(name.slice("upload-".length, -suffix.length));
    if (at <= filedAt && filedAt - at < 10_000 && (!best || at > best.at)) best = { at, name };
  }
  return best ? path.join(UPLOADS_DIR, best.name) : null;
}
