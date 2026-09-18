// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { capturePreview, dropCapture, holdCapture } from "../../_lib/captures";
import { resolveRequirement } from "../../_lib/documents";
import { badRequest, param, readJson } from "../../_lib/http";
import { ACCEPTED_DOCUMENT_FORMATS, documentMimeType } from "../../_lib/media";
import { mockDocumentsEnabled, readMockDocument } from "../../_lib/mock-documents";
import { clearProgress, reporter, type Reporter } from "../../_lib/progress";
import { captureDocument, scannerEnabled } from "../../_lib/scanner";

/**
 * Phase one of capturing a supporting document: get the paper, show it back,
 * file nothing.
 *
 * The one-shot routes next door (`/api/documents`, `/documents/scan`,
 * `/documents/mock`) capture, store and verify in a single request, which is
 * what the hands-free assistant kiosk needs. The touch kiosk splits that in
 * two: this route returns pictures of the pages it captured and holds the
 * bytes in memory, and `./confirm` stores and checks them once the citizen
 * has looked at the preview and said it is the right document. A sheet fed in
 * upside down is then caught by the person who fed it, in seconds, instead of
 * by the model a minute later.
 *
 * How the paper arrives still follows the configured source: the scanner
 * pulls it, mock mode stands it in, and an upload kiosk posts the picked file
 * as multipart form data.
 */
const MAX_UPLOAD_BYTES = Number(process.env.KIOSK_UPLOAD_MAX_BYTES ?? 10 * 1024 * 1024);

type CaptureBody = {
  serviceId: string;
  documentId: string;
  /** Client-generated id the progress route reports this capture's phase under. */
  traceId?: string;
};

type Captured = { fileName: string; bytes: Buffer; simulated: boolean };

/** Form and JSON bodies carry the same fields; read them the same way. */
async function captureRequest(
  req: Request,
): Promise<{ body: Partial<CaptureBody>; file: File | null }> {
  if (!req.headers.get("content-type")?.includes("multipart/form-data")) {
    return { body: await readJson<CaptureBody>(req), file: null };
  }
  const form = await req.formData().catch(() => null);
  if (!form) return { body: {}, file: null };
  const text = (name: string) => {
    const entry = form.get(name);
    return typeof entry === "string" ? entry : undefined;
  };
  const file = form.get("file");
  return {
    body: {
      serviceId: text("serviceId"),
      documentId: text("documentId"),
      traceId: text("traceId"),
    },
    file: file instanceof File ? file : null,
  };
}

/** The same guards the one-shot upload route applies, before anything is held. */
function rejectPickedFile(file: File): string | null {
  if (file.size === 0) return "no document file uploaded";
  if (!documentMimeType(file.name)) {
    return `only ${ACCEPTED_DOCUMENT_FORMATS} documents are accepted`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `document is too large — maximum ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`;
  }
  return null;
}

/** Mock mode's stand-in, reported as a scan so the screen reads the same. */
async function standInDocument(
  serviceId: string,
  requirementId: string,
  report: Reporter,
): Promise<Captured> {
  report("scanning");
  const mock = await readMockDocument(serviceId, requirementId);
  if (!mock) throw new Error("no stand-in document is available for this requirement");
  return { fileName: mock.fileName, bytes: mock.bytes, simulated: true };
}

export async function POST(req: Request) {
  const { body, file } = await captureRequest(req);
  const lookup = resolveRequirement(body.serviceId, body.documentId);
  if ("error" in lookup) return badRequest(lookup.error);
  if (file) {
    const refusal = rejectPickedFile(file);
    if (refusal) return badRequest(refusal);
  }
  const report = reporter(body.traceId);

  let captured: Captured;
  try {
    if (file) {
      captured = {
        fileName: file.name,
        bytes: Buffer.from(await file.arrayBuffer()),
        simulated: false,
      };
    } else if (scannerEnabled()) {
      captured = await captureDocument(lookup.service.id, lookup.requirement.id, report);
    } else if (mockDocumentsEnabled()) {
      captured = await standInDocument(lookup.service.id, lookup.requirement.id, report);
    } else {
      return badRequest("no document file uploaded");
    }
  } catch (error) {
    // Nothing came off the scanner. That is the citizen's to fix by feeding
    // the page in again, not a server fault — 408 is what the one-shot scan
    // route already answers with, and the UI reads the sentence back out.
    return Response.json(
      { error: `the capture did not complete — ${(error as Error).message}` },
      { status: 408 },
    );
  } finally {
    clearProgress(body.traceId);
  }

  const held = holdCapture({
    serviceId: lookup.service.id,
    documentId: lookup.requirement.id,
    ...captured,
  });
  return Response.json(await capturePreview(held), {
    headers: { "cache-control": "no-store" },
  });
}

/** The citizen tapped "scan again": forget the bytes rather than wait for the TTL. */
export async function DELETE(req: Request) {
  return Response.json({ discarded: dropCapture(param(req, "captureId")) });
}
