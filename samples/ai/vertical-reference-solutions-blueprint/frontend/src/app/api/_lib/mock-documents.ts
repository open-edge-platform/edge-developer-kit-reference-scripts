// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "fs/promises";
import path from "path";

/**
 * Stand-in documents for demos and development
 * (NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE=mock). The kiosk supplies the right
 * paperwork itself, so a service can be completed with no scanner attached
 * and nobody picking a file — which is what makes the assistant kiosk
 * genuinely hands-free.
 *
 * The PDFs are the ones `npm run mocks:gen` writes, and they still go through
 * the real store → OCR → LLM pipeline: this mocks the *capture*, not the
 * verification, so a demo still shows the document analysis doing its job.
 * Point KIOSK_SCANNER_MOCKS at a `.../false` folder to demo the mismatch
 * warning instead of a clean pass.
 */
const MOCKS_DIR = path.resolve(
  process.cwd(),
  process.env.KIOSK_SCANNER_MOCKS ?? "../assets/mocks/citizens/1-nadia-rahman/good",
);

export const mockDocumentsEnabled = () =>
  process.env.NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE === "mock";

/**
 * Which mock stands in for each requirement. Keyed by `serviceId:requirementId`
 * where the service matters (a "supporting document" is a payslip for welfare
 * and a police report for a lost licence), falling back to the requirement
 * alone and finally to a generic document.
 */
const MOCK_FOR: Record<string, string> = {
  identity: "mykad-copy.pdf",
  relationship: "birth-certificate.pdf",
  supporting: "generic-document.pdf",

  "dl_renew:supporting": "police-report-lost-license.pdf",
  "dl_new:supporting": "kpp01-result-slip.pdf",
  "idcard:supporting": "police-report-lost-license.pdf",
  "address:supporting": "tnb-bill.pdf",
  "birth:supporting": "hospital-birth-confirmation.pdf",
  "marriage:supporting": "surat-akuan-bujang.pdf",
  "welfare:supporting": "payslip.pdf",
  // The SKB asks for the passport bio page; without this it fell through to
  // the generic stand-in, and the demo checked a document nobody asks for.
  "police:supporting": "passport-bio-page.pdf",
};

export type MockDocument = { fileName: string; bytes: Buffer };

/** The mock document standing in for one requirement, or null if unreadable. */
export async function readMockDocument(
  serviceId: string,
  requirementId: string,
): Promise<MockDocument | null> {
  const fileName =
    MOCK_FOR[`${serviceId}:${requirementId}`] ??
    MOCK_FOR[requirementId] ??
    "generic-document.pdf";
  const bytes = await readFile(path.join(MOCKS_DIR, fileName)).catch(() => null);
  return bytes ? { fileName, bytes } : null;
}
