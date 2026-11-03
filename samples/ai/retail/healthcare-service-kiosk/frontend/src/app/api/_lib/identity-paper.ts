// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { parseScannedCode } from "@/hospital/patient-id";
import { readIdNumber } from "@/lib/document-fields";
import { findCitizenByDocument } from "./citizens";
import { delay } from "./http";
import { handoff } from "./handoff";
import { fedMockDocument, identityPaperStandIn, mockDocumentsEnabled } from "./mock-documents";
import { extractDocumentText, ocrConfigured } from "./ocr";
import { findCitizenByMrn } from "./patients";
import { scannerSimulatePolicy } from "./peripherals/policy";
import { PeripheralError } from "./peripherals/types";
import { capturePaper, readStatus, scannerEnabled, waitForFeeder, type ScannedDocument } from "./scanner";
import { withStoredPage } from "./uploads";

/** See docs/patient-journey.md, "Reading a page". */
export type PaperMode = "sensor" | "button" | "simulated" | "off";

export async function paperMode(): Promise<PaperMode> {
  if (!ocrConfigured()) return "off";
  if (mockDocumentsEnabled()) return "simulated";
  if (!scannerEnabled()) return "off";
  if (scannerSimulatePolicy() === "always") return "simulated";
  return (await readStatus()) === null ? "button" : "sensor";
}

/** Without asking the scanner: what the assistant offers. */
export const paperOffered = () => ocrConfigured() && (mockDocumentsEnabled() || scannerEnabled());

const FEEDER_POLL_MS = 1_000;

/** `rearm` waits for the last page to come out first: the fi-800R counts a page in its return path as loaded. */
export async function waitForPaper(
  mode: PaperMode,
  timeoutMs: number,
  signal: AbortSignal,
  rearm: boolean,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  if (mode === "simulated") {
    while (!signal.aborted && Date.now() < deadline) {
      if (fedMockDocument()) return true;
      await delay(FEEDER_POLL_MS);
    }
    return false;
  }
  if (mode !== "sensor") return false;
  if (rearm && (await waitForFeeder(false, timeoutMs, signal)) !== false) return false;
  return (await waitForFeeder(true, Math.max(deadline - Date.now(), 0), signal)) === true;
}

export type PaperIdentity =
  | { kind: "mrn"; mrn: string; simulated: boolean }
  | { kind: "id"; citizenId: string; simulated: boolean };

export type PaperFailure = "off" | "nothing_to_scan" | "scan_failed" | "unreadable" | "blank" | "no_identifier" | "unregistered";

export const PAPER_TAKE_BACK = "Your document has been read — please take it from the scanner.";

export const PAPER_FAILURE_MESSAGE: Record<PaperFailure, string> = {
  off: "This kiosk can't read documents right now. Scan your card or type your MRN instead.",
  nothing_to_scan: "Nothing was fed into the document scanner.",
  scan_failed: "The document scanner isn't working. Scan your card or type your MRN instead, or ask a staff member.",
  unreadable: "We couldn't read that page just now. Scan your card or type your MRN instead.",
  blank: "We couldn't find any writing on that page. Check it's the right way round and feed it in again.",
  no_identifier:
    "We couldn't find an MRN, IC or passport number on that page. Try a hospital letter, your patient card or your MyKad.",
  unregistered: "That page doesn't match a patient record here. Please ask at the registration counter.",
};

const reads = handoff<PaperIdentity>("kiosk.identity.paper", 60_000);

export const takePaperIdentity = reads.take;
export const waitForPaperIdentity = reads.wait;

/** "MRN 1234567-4" as printed, the label maybe on the line above; the check digit throws out a misread. */
const MRN_TEXT = /\bMRN\b\W{0,4}(\d{7})\s*[-–—]?\s*(\d)(?!\d)/gi;

function mrnIn(text: string): string | null {
  for (const match of text.matchAll(MRN_TEXT)) {
    const code = parseScannedCode(`MRN${match[1]}${match[2]}`);
    if (code.kind === "mrn") return code.mrn;
  }
  return null;
}

type PaperRead = { ok: true; identity: PaperIdentity } | { ok: false; reason: PaperFailure };

/** Scan what is in the feeder, read it, and hand the record it names to the identity screen. */
export async function readIdentityPaper(): Promise<PaperRead> {
  const mode = await paperMode();
  if (mode === "off") return { ok: false, reason: "off" };

  let page: ScannedDocument;
  try {
    page =
      mode === "simulated"
        ? await standIn()
        : await capturePaper(identityPaperStandIn);
  } catch (error) {
    const empty = error instanceof PeripheralError && error.reason === "nothing_to_scan";
    return { ok: false, reason: empty ? "nothing_to_scan" : "scan_failed" };
  }

  const text = await withStoredPage(page.bytes, (filePath) => extractDocumentText(filePath));
  if (!text.ok) return { ok: false, reason: text.reason === "empty" ? "blank" : text.reason === "off" ? "off" : "unreadable" };

  const mrn = mrnIn(text.text);
  const citizen = mrn ? await findCitizenByMrn(mrn) : null;
  if (mrn && citizen) {
    return present({ kind: "mrn", mrn, simulated: page.simulated });
  }
  const idNumber = readIdNumber(text.text);
  const holder = idNumber ? await findCitizenByDocument(idNumber) : null;
  if (holder) return present({ kind: "id", citizenId: holder.citizenId, simulated: page.simulated });
  return { ok: false, reason: mrn || idNumber ? "unregistered" : "no_identifier" };
}

async function standIn(): Promise<ScannedDocument> {
  const mock = await identityPaperStandIn();
  if (!mock) throw new Error("no stand-in document is available");
  await delay();
  return { ...mock, simulated: true };
}

function present(identity: PaperIdentity): PaperRead {
  reads.present(identity);
  return { ok: true, identity };
}
