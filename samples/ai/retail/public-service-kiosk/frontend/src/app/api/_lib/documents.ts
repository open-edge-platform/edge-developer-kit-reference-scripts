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
import { discardDocument, storeDocumentPages, type StoredDocument } from "./uploads";

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

/** One kind of paperwork in a capture: indexes into the extraction's `pages`. */
type CapturePart = { documentType: string; pages: number[] };

type CaptureText = { text: string; pages: string[]; sheets: number[] };

/**
 * The distinct kinds of paperwork in a capture, in the order they were fed,
 * each kind's sheets together.
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
function captureParts(capture: CaptureText, found: CapturedDocument[] | null): CapturePart[] {
  const all = capture.pages.map((_, index) => index);
  if (!found) return [{ documentType: "", pages: all }];
  const kinds = new Map<string, CapturePart>();
  let lastKey = "";
  for (const document of found) {
    const name = document.documentType.trim();
    // An unnamed group is not a different kind: it stays with the sheets before it.
    const key = name ? typeKey(name) : lastKey;
    const kind = kinds.get(key) ?? { documentType: name || "Document", pages: [] };
    kind.pages.push(...document.pages.map((page) => page - 1));
    kinds.set(key, kind);
    lastKey = key;
  }
  const parts = [...kinds.values()];
  return parts.length > 1 ? parts : [{ documentType: parts[0]?.documentType ?? "", pages: all }];
}

const GENERIC_WORDS = new Set(["DOCUMENT", "PAGE", "COPY"]);

const wordsOf = (text: string) =>
  new Set(
    text
      .toUpperCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2 && !GENERIC_WORDS.has(word)),
  );

const sharedWords = (a: Set<string>, b: Set<string>) => [...a].filter((word) => b.has(word)).length;

const requirementWords = ({ requirement }: RequirementLookup) =>
  wordsOf([requirement.label, requirement.hint, ...(requirement.accepts ?? [])].join(" "));

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

type CaptureRead = CaptureText & { parts: CapturePart[] };

/** OCR plus the grouping question; a verdict instead when the capture cannot be read at all. */
async function readCapture(
  stored: StoredDocument,
  report: Reporter,
): Promise<CaptureRead | DocumentAnalysis> {
  if (!llmEnabled()) return unchecked("Document checking is not configured on this kiosk.");
  report("reading");
  const extraction = await extractDocumentText(stored.filePath, report);
  if (!extraction.ok) return unchecked(EXTRACTION_MESSAGES[extraction.reason]);
  // Before asking whether this is the right document, establish that it IS a
  // document: a feeder takes whatever is put in it, and the check below reads
  // every sheet as one piece of paperwork. A grouping that could not be
  // reached (null) is not a refusal — the verification that follows has its
  // own policy for a model that would not answer.
  let found: CapturedDocument[] | null = null;
  if (singleDocumentPerCapture()) {
    report("grouping");
    found = await groupCapturedDocuments(extraction.pages);
  }
  return { ...extraction, parts: captureParts(extraction, found) };
}

/** A sorted capture in which none of the documents was one still asked for. */
function noneWanted(types: string[]): DocumentAnalysis {
  return {
    status: "rejected",
    typeMatches: false,
    documentType: types[0] ?? "Document",
    holderName: null,
    address: null,
    summary: `This scan held ${namedTypes(types)}, and none of them is a document this service still needs.`,
  };
}

/**
 * OCR → LLM verification of a captured document. Always returns a verdict:
 * when the pipeline cannot reach one, that verdict is "unverified", which is
 * never a pass. Returning nothing at all is what previously let an unreadable
 * page — or a model that was simply down — count as an accepted document.
 */
export async function analyzeStoredDocument(
  lookup: RequirementLookup,
  stored: StoredDocument,
  documentNumber?: string,
  relatedName?: string,
  /** Names each stage as it starts, for the progress bar the citizen watches. */
  report: Reporter = () => {},
): Promise<DocumentAnalysis> {
  const read = await readCapture(stored, report);
  if ("status" in read) return read;
  if (read.parts.length > 1) return mixedCapture(read.parts.map((part) => part.documentType));
  return (await checkDocument(lookup, read.text, documentNumber, relatedName, report)).analysis;
}

/** One requirement's share of a capture, and what the check made of it. */
export type FiledDocument = {
  requirement: DocumentRequirement;
  stored: StoredDocument;
  analysis: DocumentAnalysis;
};

export type SortedCapture = {
  filed: FiledDocument[];
  /** Kinds of paperwork in the capture that none of the open requirements wanted. */
  leftOut: string[];
};

/**
 * Files each document in a capture under whichever of `open` (the asked one
 * first) it satisfies; a stack is split so every document is stored and
 * checked on its own pages only.
 */
export async function sortCapture(
  open: RequirementLookup[],
  stored: StoredDocument,
  documentNumber?: string,
  report: Reporter = () => {},
): Promise<SortedCapture> {
  const [asked] = open;
  const whole = (lookup: RequirementLookup, analysis: DocumentAnalysis): SortedCapture => ({
    filed: [{ requirement: lookup.requirement, stored, analysis }],
    leftOut: [],
  });
  const read = await readCapture(stored, report);
  if ("status" in read) return whole(asked, read);

  const textOf = (pages: number[]) => pages.map((page) => read.pages[page]).join("\n");
  const check = (lookup: RequirementLookup, pages: number[]) =>
    checkDocument(lookup, textOf(pages), documentNumber, undefined, report);

  type Placement = {
    lookup: RequirementLookup;
    pages: number[];
    words: Set<string>;
    checked: CheckedDocument;
    grown: boolean;
  };
  const placements: Placement[] = [];
  const waiting = [...open];
  const leftOut: string[] = [];
  let askedVerdict: CheckedDocument | undefined;
  for (const part of read.parts) {
    const words = wordsOf(part.documentType);
    // Each check is a model call, so the requirement the grouping's name points at goes first.
    const likeliest = [...waiting].sort(
      (a, b) => sharedWords(words, requirementWords(b)) - sharedWords(words, requirementWords(a)),
    );
    let placed = false;
    for (const lookup of likeliest) {
      const checked = await check(lookup, part.pages);
      if (lookup === asked) askedVerdict = askedVerdict ?? checked;
      if (checked.isType === false) continue;
      // A check that never ran says nothing about which paper this is.
      const target = checked.isType === null && waiting.includes(asked) ? asked : lookup;
      placements.push({ lookup: target, pages: [...part.pages], words, checked, grown: false });
      waiting.splice(waiting.indexOf(target), 1);
      placed = true;
      break;
    }
    // A later sheet of a document already placed, that the grouping named differently.
    for (const placement of placed ? [] : placements) {
      if (sharedWords(words, placement.words) === 0) continue;
      if ((await check(placement.lookup, part.pages)).isType !== true) continue;
      placement.pages.push(...part.pages);
      for (const word of words) placement.words.add(word);
      placement.grown = true;
      placed = true;
      break;
    }
    if (!placed) leftOut.push(part.documentType);
  }

  if (read.parts.length === 1) {
    // One document that is none of them stays the asked requirement's refusal.
    const [only] = placements;
    return only ? whole(only.lookup, only.checked.analysis) : whole(asked, askedVerdict!.analysis);
  }
  if (placements.length === 0) return whole(asked, noneWanted(leftOut));
  const filed: FiledDocument[] = [];
  for (const { lookup, pages, checked, grown } of placements) {
    pages.sort((a, b) => a - b);
    filed.push({
      requirement: lookup.requirement,
      stored: await storeDocumentPages(
        lookup.service.id,
        lookup.requirement.id,
        stored,
        pages.map((page) => read.sheets[page]),
      ),
      analysis: grown ? (await check(lookup, pages)).analysis : checked.analysis,
    });
  }
  await discardDocument(stored);
  return { filed, leftOut };
}

type CheckedDocument = {
  analysis: DocumentAnalysis;
  /** The model's own word on whether this is the required kind of paperwork; null when it never answered. */
  isType: boolean | null;
};

async function checkDocument(
  { service, requirement, isRelationshipProof }: RequirementLookup,
  text: string,
  documentNumber: string | undefined,
  relatedName: string | undefined,
  report: Reporter,
): Promise<CheckedDocument> {
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
    text,
  });
  // The model being unreachable is the same situation as OCR being
  // unreachable, so it goes through the same policy rather than around it.
  if (analysis.status === "unverified") return { analysis: unchecked(analysis.summary), isType: null };
  const named = withRegisteredName(analysis, citizen?.name);
  const checked = expectedNationalId ? carriesRegisteredId(named, expectedNationalId, text) : named;
  return {
    analysis: requirement.addressField ? provesNewAddress(checked, citizen) : checked,
    isType: analysis.typeMatches || analysis.status === "accepted",
  };
}

const nameKey = (name: string) => name.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");

/** OCR drops spaces ("NADIARAHMAN"): a holder name that only differs from the registry's in spacing, case or punctuation is shown as the registry spells it. */
function withRegisteredName(analysis: DocumentAnalysis, registeredName?: string): DocumentAnalysis {
  if (!registeredName || !analysis.holderName) return analysis;
  return nameKey(analysis.holderName) === nameKey(registeredName)
    ? { ...analysis, holderName: registeredName }
    : analysis;
}

/** A registry ID as printed on Malaysian and Vietnamese paperwork: two country
 *  letters and ten digits, e.g. MY7394142145. */
const ID_TOKEN = /(?<![A-Z0-9])[A-Z]{2}\d{10}(?!\d)/g;
/** The same, with anything before the letters and a space allowed after them. */
const LOOSE_ID_TOKEN = /(?<!\d)([A-Z]{2}) ?(\d{10})(?!\d)/g;

/** OCR drops and inserts spaces, so an ID with the registry's own country letters is also found glued to the word before it ("KPMY…") or split after them ("MY 739…"). */
function printedIds(text: string, expectedNationalId: string): string[] {
  const upper = text.toUpperCase();
  const found = [...upper.matchAll(ID_TOKEN)].map((m) => m[0]);
  const country = /^([A-Z]{2})\d{10}$/.exec(expectedNationalId.toUpperCase())?.[1];
  if (country) {
    for (const [, letters, digits] of upper.matchAll(LOOSE_ID_TOKEN)) {
      if (letters === country) found.push(letters + digits);
    }
  }
  return [...new Set(found)];
}

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
  const printed = printedIds(text, expectedNationalId);
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
  return Response.json(documentPayload(requirement, stored, analysis, simulated));
}

export function documentPayload(
  requirement: DocumentRequirement,
  stored: StoredDocument,
  analysis: DocumentAnalysis,
  simulated?: boolean,
) {
  return {
    documentId: requirement.id,
    fileName: stored.fileName,
    title: stored.title,
    pages: stored.pages,
    sizeKb: stored.sizeKb,
    uploadedAt: stored.uploadedAt,
    analysis,
    ...(simulated ? { simulated } : {}),
  };
}
