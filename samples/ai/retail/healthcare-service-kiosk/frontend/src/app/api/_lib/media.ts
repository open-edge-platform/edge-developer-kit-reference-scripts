// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from "path";

/**
 * The document formats the kiosk accepts, in one place because every leg of
 * the pipeline needs to agree on them: the upload route's guard, the name a
 * captured file is stored under, the type OCR is handed, and the two paths
 * that post a captured document back into the upload route.
 *
 * Everything is stored as a PDF. A scan — one JPEG per sheet off the
 * scanner — is packed into one before it leaves the capture (see ./scanner),
 * and a photo or image someone uploads is wrapped into a one-page PDF as it
 * is stored (see ./uploads), so the rest of the pipeline sees one format.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/** A photo or image upload, which is wrapped into a PDF before anything reads it. */
export const isImageDocument = (fileName: string) => documentMimeType(fileName)?.startsWith("image/") ?? false;

export const DOCUMENT_PICKER_ACCEPT = "application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png";

/** The document's media type from its name, or null if it is not one we take. */
export function documentMimeType(fileName: string): string | null {
  return MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? null;
}

/** Human-readable list for the "we don't take that" message. */
export const ACCEPTED_DOCUMENT_FORMATS = "PDF, JPG or PNG";
