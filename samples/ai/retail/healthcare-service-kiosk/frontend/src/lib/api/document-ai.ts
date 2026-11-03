// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { apiPost } from "./client";

export type DocumentReadRequest = {
  serviceId: string;
  documentId: string;
  documentNumber: string;
  /** Pins the upload, as the documents step recorded it. */
  uploadedAt: string;
};

/** Fields read off a document the kiosk already checked; the shape is the service's own. A 404 means no text could be read. */
export function readDocument<T>(request: DocumentReadRequest): Promise<T> {
  return apiPost<T>("/document-ai", request);
}
