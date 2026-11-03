// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile } from "fs/promises";
import path from "path";
import { department } from "@/hospital/data";
import { patientRecord } from "@/hospital/records";
import { formatShortDate } from "@/lib/format";
import { fileForRole, person, renderSet } from "@/packs/malaysia/mock-documents.mjs";
import { dateOfBirthIso, pickReaderCitizen, type CitizenDoc } from "./citizens";
import { appointmentsToday } from "./patients";
import { servedPatient } from "./served-patient";
import { signedSlipCode } from "./slips";

/**
 * Stand-in documents for demos and development
 * (NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE=mock, or a simulated scanner). The kiosk
 * supplies the paperwork itself, so a service can be completed with no
 * scanner attached and nobody picking a file.
 *
 * The paperwork is the patient's own: the documents /mock-documents offers,
 * rendered for whoever last passed the identity check at this terminal, so
 * the holder check passes for any patient rather than one pinned in config.
 * Staff can put a particular document in the feeder instead, a tampered one
 * included (`feedMockDocument`). It still goes through the real store → OCR →
 * LLM pipeline: this mocks the *capture*, not the verification.
 *
 * KIOSK_SCANNER_MOCKS (`documents.mocks_dir`) names a folder of PDFs to use
 * instead, laid out like `npm run mocks:gen` writes them.
 */
const MOCKS_DIR = process.env.KIOSK_SCANNER_MOCKS?.trim()
  ? path.resolve(process.cwd(), process.env.KIOSK_SCANNER_MOCKS.trim())
  : null;

export const mockDocumentsEnabled = () =>
  process.env.NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE === "mock";

/**
 * Which kind of paperwork stands in for each requirement. Keyed by
 * `serviceId:requirementId` where the service matters, falling back to the
 * requirement alone and finally to a generic supporting document.
 */
const ROLE_FOR: Record<string, string> = {
  identity: "identity",
  supporting: "referral",
  referral: "referral",
  medical: "medical",
  "insurance-card": "insurance-card",
};

export type MockDocument = { fileName: string; bytes: Buffer };

type MockPerson = ReturnType<typeof person>;

/** The document builders' person for a registry row, with what only the hospital knows: MRN, today's slip, the policy on file. */
export async function mockPerson(c: CitizenDoc, opts: { codes?: boolean } = {}): Promise<MockPerson> {
  const record = patientRecord(c.citizenId);
  const codes = opts.codes ?? true;
  const visit = codes ? (await appointmentsToday(c))[0] : undefined;
  const clinic = visit ? department(visit.department) : undefined;
  return person({
    CitizenKey: c.citizenKey,
    SyntheticCitizenID: c.citizenId,
    SyntheticName: c.name,
    Country: c.country,
    Age: c.age ?? "",
    Phone: c.phone ?? "",
    Email: c.email ?? "",
    AddressLine: c.address?.line ?? "",
    City: c.address?.city ?? "",
    Postcode: c.address?.postcode ?? "",
    DateOfBirth: dateOfBirthIso(c),
    Sex: c.sex ?? "",
    Mrn: codes ? record.mrn : "",
    Slip: visit
      ? {
          code: signedSlipCode(visit.reference),
          reference: visit.reference,
          date: formatShortDate(visit.date),
          time: visit.time,
          clinic: clinic?.name ?? visit.department,
          doctor: visit.doctor,
          place: clinic ? `${clinic.building}, ${clinic.floor}` : "",
        }
      : null,
    Policy: record.policy
      ? {
          payer: record.policy.payer,
          memberId: record.policy.memberId,
          policyNumber: record.policy.policyNumber,
          expiry: record.policy.expiry,
        }
      : null,
  });
}

/** Paper left in the feeder this long is somebody else's demo. */
const FED_TTL_MS = 10 * 60_000;

type Fed = MockDocument & { label: string; at: number };

const FEEDER = Symbol.for("kiosk.mockDocuments.feeder");
type Global = { [FEEDER]?: Fed | null };

/** Staff put one document in the simulated feeder: the next stood-in scan is that page, whatever the step asks for. */
export function feedMockDocument(doc: MockDocument & { label: string }): void {
  (globalThis as Global)[FEEDER] = { ...doc, at: Date.now() };
}

/** What is waiting in the feeder, without taking it. */
export function fedMockDocument(): { fileName: string; label: string; at: string } | null {
  const fed = (globalThis as Global)[FEEDER];
  if (!fed || Date.now() - fed.at > FED_TTL_MS) return null;
  return { fileName: fed.fileName, label: fed.label, at: new Date(fed.at).toISOString() };
}

export function clearFedMockDocument(): void {
  (globalThis as Global)[FEEDER] = null;
}

function takeFed(): MockDocument | null {
  const fed = (globalThis as Global)[FEEDER];
  (globalThis as Global)[FEEDER] = null;
  return fed && Date.now() - fed.at <= FED_TTL_MS ? { fileName: fed.fileName, bytes: fed.bytes } : null;
}

/** The folder's file for a role: the identity document is whichever ID copy the folder has. */
async function fromFolder(dir: string, role: string, P: MockPerson | null): Promise<MockDocument | null> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const wanted = (P && fileForRole(P, role)) ?? null;
  const candidates =
    role === "identity" ? [wanted, "mykad-copy.pdf", "passport-copy.pdf"] : [wanted, ROLE_FILE[role]];
  const fileName = candidates.find((name): name is string => Boolean(name) && names.includes(name!));
  if (!fileName) return null;
  const bytes = await readFile(path.join(dir, fileName)).catch(() => null);
  return bytes ? { fileName, bytes } : null;
}

/** A folder written before the generator knew roles still names its files this way. */
const ROLE_FILE: Record<string, string> = {
  referral: "referral-letter.pdf",
  medical: "lab-report.pdf",
  "insurance-card": "insurance-card.pdf",
};

/** What the identity screen's document scan reads: the page in the feeder, else the waiting patient's MyKad or passport copy. */
export async function identityPaperStandIn(): Promise<MockDocument | null> {
  const fed = takeFed();
  if (fed) return fed;
  const citizen = await pickReaderCitizen();
  const P = citizen ? await mockPerson(citizen, { codes: false }) : null;
  if (MOCKS_DIR) return fromFolder(MOCKS_DIR, "identity", P);
  const fileName = P && fileForRole(P, "identity");
  if (!P || !fileName) return null;
  const [doc] = await renderSet(P, null, fileName);
  return doc ? { fileName, bytes: doc.bytes } : null;
}

/** The mock document standing in for one requirement, or null if none can be produced. */
export async function readMockDocument(
  serviceId: string,
  requirementId: string,
): Promise<MockDocument | null> {
  const fed = takeFed();
  if (fed) return fed;

  const role = ROLE_FOR[`${serviceId}:${requirementId}`] ?? ROLE_FOR[requirementId] ?? "referral";
  const citizen = (await servedPatient()) ?? (await pickReaderCitizen());
  const P = citizen ? await mockPerson(citizen, { codes: false }) : null;
  if (MOCKS_DIR) return fromFolder(MOCKS_DIR, role, P);
  if (!P) return null;

  const fileName = fileForRole(P, role);
  if (!fileName) return null;
  const [doc] = await renderSet(P, null, fileName);
  return doc ? { fileName, bytes: doc.bytes } : null;
}
