// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from "path";

/**
 * The document formats the kiosk accepts, in one place because every leg of
 * the pipeline needs to agree on them: the upload route's guard, the name a
 * captured file is stored under, the type OCR is handed, and the two paths
 * that post a captured document back into the upload route.
 *
 * PDF is the only one, for now. A manual upload already is one, and a scan —
 * which comes off the scanner as one JPEG per sheet — is packed into one
 * before it leaves the capture (see ./scanner), so the pages of a document
 * stay together as the single file the rest of the pipeline expects.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
};

/** The document's media type from its name, or null if it is not one we take. */
export function documentMimeType(fileName: string): string | null {
  return MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? null;
}

/** Human-readable list for the "we don't take that" message. */
export const ACCEPTED_DOCUMENT_FORMATS = "PDF";
