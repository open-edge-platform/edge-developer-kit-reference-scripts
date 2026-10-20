// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getService } from "@/services";
import type { DocumentRequirement, ServiceDefinition } from "@/services/types";
import { findCitizenByDocument, formatAddress, type CitizenDoc } from "./citizens";
import {
  analyzeDocument,
  groupCapturedDocuments,
  llmEnabled,
  requireDocumentVerification,
  unverifiedAnalysis,
  type AnalysisTask,
  type CapturedDocument,
  type DocumentAnalysis,
} from "./llm";
import { extractDocumentText, type ExtractionFailure } from "./ocr";
import type { Reporter } from "./progress";
import type { StoredDocument } from "./uploads";

/**
 * Document capture shared by both intake routes: the manual PDF upload
 * (`/api/documents`) and the attached scanner (`/api/documents/scan`). Both
 * end with the same stored file → OCR → LLM verification pipeline; only how
 * the PDF arrives differs.
 */

export type RequirementLookup = {
  service: ServiceDefinition;
  requirement: DocumentRequirement;
  /** A relationship proof is verified against both parties, not just the applicant. */
  isRelationshipProof: boolean;
};

/** Find the requirement (or nested relationship proof) a captured document satisfies. */
export function resolveRequirement(
  serviceId: unknown,
  documentId: unknown,
): RequirementLookup | { error: string } {
  const service = typeof serviceId === "string" ? getService(serviceId) : null;
  if (!service) return { error: "unknown serviceId" };
  const requirement =
    service.documents.find((doc) => doc.id === documentId) ??
    service.documents.find((doc) => doc.relationshipProof?.id === documentId)?.relationshipProof;
  if (!requirement) return { error: "unknown documentId for this service" };
  const isRelationshipProof = service.documents.some(
    (doc) => doc.relationshipProof?.id === requirement.id,
  );
  return { service, requirement, isRelationshipProof };
}

/** Why a document could not be read, in words for the kiosk screen. */
const EXTRACTION_MESSAGES: Record<ExtractionFailure, string> = {
  off: "Document checking is not configured on this kiosk.",
  failed: "The document could not be read — the text-recognition service is unavailable.",
  empty: "No text could be read from this document — check it was fed in the right way up.",
};

/**
 * What a document nobody could check counts as.
 *
 * This is the single place that policy lives, so no caller has to remember
 * it. With verification required (the default) an unchecked document is
 * "unverified", which satisfies nothing and stops the flow. Only an install
 * that has deliberately turned verification off accepts it — and says so on
 * screen rather than pretending a check happened.
 */
function unchecked(detail: string): DocumentAnalysis {
  if (requireDocumentVerification()) return unverifiedAnalysis(detail);
  return {
    status: "accepted",
    typeMatches: true,
    documentType: "Document",
    holderName: null,
    address: null,
    summary: "Not checked — document verification is turned off on this kiosk.",
  };
}

/**
 * Whether one capture has to be one document. True by default: a requirement
 * is satisfied by a document, not by a pile of paper that contains one, and
 * everything downstream — the holder check, the printed-ID cross-check, the
 * address read off a proof — assumes it is reading a single piece of
 * paperwork. Set `documents.single_document_per_capture: false` in
 * config.yaml for an install that would rather let a mixed stack through than
 * ask the citizen to feed their papers in one at a time.
 */
const singleDocumentPerCapture = () =>
  (process.env.KIOSK_SINGLE_DOCUMENT_PER_CAPTURE ?? "true") !== "false";

/** Two names for the same paperwork, as far as this check is concerned. */
const typeKey = (documentType: string) =>
  documentType.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The distinct kinds of paperwork in a capture, in the order they were fed.
 *
 * Grouping alone is not the question — the number of GROUPS is not the number
 * of documents. Asked to group four sheets of one electricity bill, the model
 * splits them into two "Electricity Bill" groups as readily as it keeps them
 * together, and refusing on the group count alone turns that into a citizen
 * holding exactly the right paper being told to feed it in one sheet at a
 * time, twice, and then give up.
 *
 * So only a capture holding paperwork of DIFFERENT kinds is refused. That is
 * also the only thing worth refusing: the harm being prevented is a second,
 * unrelated document riding along unchecked, and two copies of the required
 * bill are not that. It errs the safe way round — the check that follows
 * still has to accept whatever this lets through, whereas nothing downstream
 * can rescue a genuine document this refuses.
 */
function distinctTypes(found: CapturedDocument[]): string[] {
  const seen = new Map<string, string>();
  for (const document of found) {
    const name = document.documentType.trim();
    if (name) seen.set(typeKey(name), name);
  }
  return [...seen.values()];
}

/** "a Utility Bill and a MyKad", for the sentence the citizen reads. */
function namedTypes(names: string[]): string {
  if (names.length < 2) return "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The refusal for a capture that turned out to hold more than one document.
 *
 * `typeMatches` is false deliberately. True is what the kiosk reads as "right
 * document, wrong holder" and answers by offering the relationship-proof
 * fallback — and nothing here is about whose document it is. The citizen fed
 * two things in at once; the answer is to feed them in one at a time.
 */
function mixedCapture(types: string[]): DocumentAnalysis {
  return {
    status: "rejected",
    typeMatches: false,
    documentType: types[0] ?? "Document",
    holderName: null,
    address: null,
    summary:
      `This capture holds ${types.length} different documents (${namedTypes(types)}) — ` +
      "please feed them in one at a time, starting with the one this step asks for.",
  };
}

/**
 * OCR → LLM verification of a captured document. Always returns a verdict:
 * when the pipeline cannot reach one, that verdict is "unverified", which is
 * never a pass. Returning nothing at all is what previously let an unreadable
 * page — or a model that was simply down — count as an accepted document.
 */
export async function analyzeStoredDocument(
  { service, requirement, isRelationshipProof }: RequirementLookup,
  stored: StoredDocument,
  documentNumber?: string,
  relatedName?: string,
  /** Names each stage as it starts, for the progress bar the citizen watches. */
  report: Reporter = () => {},
): Promise<DocumentAnalysis> {
  if (!llmEnabled()) return unchecked("Document checking is not configured on this kiosk.");
  report("reading");
  const extraction = await extractDocumentText(stored.filePath, report);
  if (!extraction.ok) return unchecked(EXTRACTION_MESSAGES[extraction.reason]);
  // Before asking whether this is the right document, establish that it IS a
  // document: a feeder takes whatever is put in it, and the check below reads
  // every sheet as one piece of paperwork. A grouping that could not be
  // reached (null) is not a refusal — the verification that follows has its
  // own policy for a model that would not answer.
  if (singleDocumentPerCapture()) {
    report("grouping");
    const found = await groupCapturedDocuments(extraction.pages);
    const types = found ? distinctTypes(found) : [];
    if (types.length > 1) return mixedCapture(types);
  }
  const citizen = documentNumber ? await findCitizenByDocument(documentNumber) : null;
  // Only the details this paperwork actually prints are compared. Asking the
  // model about one the document cannot carry — an IC number on a utility
  // bill, an address on a test-result slip — is what makes it invent the
  // value it was handed and then rule on it.
  const wanted = requirement.holderDetails ?? ["name", "nationalId"];
  const expectedName = wanted.includes("name") ? citizen?.name : undefined;
  const expectedNationalId = wanted.includes("nationalId") ? citizen?.citizenId : undefined;
  const task: AnalysisTask = isRelationshipProof
    ? {
        kind: "relationship-proof",
        expectedName: citizen?.name,
        relatedName: relatedName || "the supporting document's holder",
      }
    : requirement.addressField
      ? { kind: "address-proof", expectedName, expectedNationalId }
      : { kind: "document", expectedName, expectedNationalId };
  report("checking");
  const analysis = await analyzeDocument({
    serviceLabel: service.label,
    requirementLabel: requirement.label,
    requirementHint: requirement.hint,
    accepts: requirement.accepts,
    holderRole: requirement.holderRole,
    task,
    text: extraction.text,
  });
  // The model being unreachable is the same situation as OCR being
  // unreachable, so it goes through the same policy rather than around it.
  if (analysis.status === "unverified") return unchecked(analysis.summary);
  const checked = expectedNationalId
    ? carriesRegisteredId(analysis, expectedNationalId, extraction.text)
    : analysis;
  return requirement.addressField ? provesNewAddress(checked, citizen) : checked;
}

/** A registry ID as printed on Malaysian and Vietnamese paperwork: two country
 *  letters and ten digits, e.g. MY7394142145. */
const ID_TOKEN = /\b[A-Z]{2}\d{10}\b/g;

/**
 * The registry cross-check the model should never have been trusted with: the
 * ID number is printed on the page and the registry holds it, so whether they
 * are the same string is a string comparison, not a judgement. Small models
 * read "MY0627475478" against an expected "MY7394142145" and answer that the
 * holder details match — measured 5/5 on the digit-tampered KPP01 slip.
 *
 * Only a document that prints an ID of its own is judged here. One where OCR
 * found no ID at all is left to the model's verdict: a page whose ID line was
 * smudged is not the same thing as a page bearing someone else's, and refusing
 * it would fail genuine documents for a bad scan.
 */
function carriesRegisteredId(
  analysis: DocumentAnalysis,
  expectedNationalId: string,
  text: string,
): DocumentAnalysis {
  if (analysis.status !== "accepted") return analysis;
  const printed = [...text.toUpperCase().matchAll(ID_TOKEN)].map((m) => m[0]);
  if (printed.length === 0 || printed.includes(expectedNationalId.toUpperCase())) return analysis;
  return {
    ...analysis,
    status: "rejected",
    // The paperwork is the right kind and names another person's ID, which is
    // exactly the case the relationship-proof fallback exists for.
    typeMatches: analysis.typeMatches,
    summary:
      `The ID number printed on this document (${printed[0]}) is not the one registered ` +
      "to you.",
  };
}

/** Letters and digits only: the same address printed by two different
 *  organisations differs in punctuation, case and line breaks, and OCR adds
 *  its own. */
const addressKey = (address: string) => address.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The extra thing a proof of address has to prove: that the home on it is not
 * the one already on file. The document check above only establishes whose
 * document it is — a bill for the address the registry already holds passes
 * that and still proves nothing, and applying it would file an address change
 * that changes no address.
 *
 * Compared here rather than by the model: it is a string comparison against
 * the registry, and the registry is not something to ask a model about. A
 * printed address usually omits the country the registry stores, so either
 * string containing the other counts as the same place; anything less certain
 * counts as a new address, which errs towards letting the citizen through.
 */
function provesNewAddress(analysis: DocumentAnalysis, citizen: CitizenDoc | null): DocumentAnalysis {
  if (analysis.status !== "accepted") return analysis;
  // typeMatches goes false with both refusals below, and deliberately: a
  // rejection that keeps typeMatches is what the kiosk reads as "right
  // document, wrong holder", and it answers that by offering the
  // relationship-proof fallback. Neither refusal here is about who the
  // document belongs to — it is the applicant's own bill, for the wrong
  // home — so proving a family link would be an answer to a question nobody
  // asked.
  if (!analysis.address) {
    return {
      ...analysis,
      status: "rejected",
      typeMatches: false,
      summary: "No address could be read from this document — it cannot prove a new home.",
    };
  }
  if (!citizen) return analysis;
  const printed = addressKey(analysis.address);
  const registered = addressKey(formatAddress(citizen));
  const same = printed.includes(registered) || registered.includes(printed);
  return same
    ? {
        ...analysis,
        status: "rejected",
        typeMatches: false,
        summary:
          "This document shows the address already registered to you — to change it, " +
          "upload one showing your new home.",
      }
    : analysis;
}

/** The `UploadedDocument` payload the kiosk UI expects from both routes. */
export function documentResponse(
  requirement: DocumentRequirement,
  stored: StoredDocument,
  analysis: DocumentAnalysis,
  /** Set by scanner mode when no scanner answered and a stand-in was used. */
  simulated?: boolean,
): Response {
  return Response.json({
    documentId: requirement.id,
    fileName: stored.fileName,
    title: stored.title,
    pages: stored.pages,
    sizeKb: stored.sizeKb,
    uploadedAt: stored.uploadedAt,
    analysis,
    ...(simulated ? { simulated } : {}),
  });
}
