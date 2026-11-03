// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { t } from "@/lib/i18n";
import { readFile } from "fs/promises";
import path from "path";
import { getService, type ServiceDefinition } from "@/services";
import { formatDateTime, formatMoney } from "@/lib/format";
import { idReaderCopy, isReaderFault, readerFaultHelp } from "@/lib/id-reader";
import { PAPER_TAKE_BACK, paperOffered } from "../identity-paper";
import { cmsFindOne } from "../cms";
import { findCitizenByDocument, toProfile } from "../citizens";
import { documentMimeType } from "../media";
import { callRoute, routeError } from "../route-call";
import { discardEnrollment, SEE_THE_COUNTER } from "../self-enrollment";
import { POST as applicationsRoute } from "../../applications/route";
import { POST as documentsRoute } from "../../documents/route";
import { GET as enrollCardRoute } from "../../enroll/card/route";
import { POST as enrollRoute } from "../../enroll/route";
import { GET as readIdDocumentRoute } from "../../identity/document/route";
import { POST as verifyIdentityRoute } from "../../identity/verify/route";
import { POST as paymentsRoute } from "../../payments/route";
import {
  DELETE as requestsDeleteRoute,
  GET as requestsGetRoute,
  POST as requestsPostRoute,
} from "../../requests/route";
import { fetchQuote } from "./bridge";
import { chainFor } from "@/packs/index.server";
import { PHYSICAL_STEP_ANSWERS, REQUESTS_FLOW_ID } from "./types";
import { dropOpenSession, isOpenSession, readOpenSession, saveOpenSession } from "./open-sessions";
import {
  grantVerification,
  joinSession,
  splitSession,
  verificationHolds,
  verifiedHolder,
} from "./verified-sessions";
import type {
  Ask,
  ChainContext,
  CitizenProfile,
  ContinueFlowArgs,
  FlowResponse,
  FlowUpload,
} from "./types";

type DocumentAnalysis = {
  /** "unverified" is a check that could not run — never a pass. */
  status: "accepted" | "rejected" | "unverified";
  typeMatches: boolean;
  holderName: string | null;
  address: string | null;
  summary: string;
};

type UploadedDocument = {
  documentId: string;
  fileName: string;
  analysis: DocumentAnalysis | null;
} & Record<string, unknown>;

type UploadedDocuments = Record<string, UploadedDocument>;

type DraftDoc = {
  id: number;
  requestId: string;
  serviceId: string;
  documentNumber: string;
  data?: Record<string, string> | null;
  documents?: UploadedDocuments | null;
};

/** The only verdict that satisfies a requirement — a check that never ran must not count as accepted. */
const isAccepted = (doc?: UploadedDocument) => doc?.analysis?.status === "accepted";

const isRejected = (doc?: UploadedDocument) => doc?.analysis?.status === "rejected";

/** Right kind of document, but it carries another person's name. */
const isWrongHolder = (doc?: UploadedDocument) =>
  isRejected(doc) && doc?.analysis?.typeMatches === true;

const PAYMENT_METHODS = ["card", "qr", "cash"] as const;

function response(
  ctx: ChainContext,
  sessionId: string | null,
  partial: Pick<FlowResponse, "status" | "say"> & Partial<FlowResponse>,
): FlowResponse {
  const say = [...ctx.notes, partial.say].filter(Boolean).join("\n\n");
  return {
    sessionId,
    serviceId: ctx.service.id,
    serviceLabel: ctx.service.label,
    citizen: ctx.documentNumber ? { name: ctx.profile.name, documentNumber: ctx.documentNumber } : null,
    asks: [],
    receipt: null,
    ...partial,
    say,
  };
}

function failure(serviceId: string, serviceLabel: string, say: string): FlowResponse {
  return {
    status: "failed",
    sessionId: null,
    serviceId,
    serviceLabel,
    citizen: null,
    say,
    asks: [],
    receipt: null,
  };
}

function biometricMethod(answer: string | undefined): string | undefined {
  return answer === "done" ? "face" : answer;
}

/** Engine-internal flow-data keys. Answers come straight off the client, so
 *  an answer may never write one. */
const isInternalKey = (key: string) => key.startsWith("_");

const OTHER_WAYS_IN = paperOffered()
  ? "No card? Hold your patient card or appointment slip under the scanner light, feed a hospital letter or " +
    "your passport into the document scanner, or type your MRN on the screen."
  : "No card? Hold your patient card or appointment slip under the scanner light, or type your MRN on the screen.";

const INSERT_DOCUMENT_ASK: Ask = {
  id: "insertDocument",
  type: "action",
  modal: true,
  // Fallback for a terminal with no working reader — see `useCardWatch`.
  autoAdvanceMs: 2_500,
  question: `${idReaderCopy().spoken} ${OTHER_WAYS_IN}`,
};

const BIOMETRIC_SCAN_MS = Number(process.env.KIOSK_IDENTITY_SCAN_MS ?? 2_300);

const BIOMETRIC_ASK: Ask = {
  id: "biometric",
  type: "action",
  modal: true,
  autoAdvanceMs: BIOMETRIC_SCAN_MS,
  question:
    "Now look at the camera above the screen so I can check it's really you — " +
    "the scan runs by itself and takes a couple of seconds.",
};

/** Retry copy per reader failure — the failures do not share a remedy. */
function readerRetry(reason: string | undefined, detail: string): { say: string; note: string } {
  const copy = idReaderCopy();
  if (reason === "timeout") {
    return { say: `I didn't detect a card. ${copy.hold}`, note: copy.hold };
  }
  if (reason === "unregistered") {
    return { say: `${sentence(detail)} ${copy.remove}`, note: sentence(detail) };
  }
  if (isReaderFault(reason)) {
    const fault = `${sentence(detail)} ${readerFaultHelp()}`;
    return { say: fault, note: fault };
  }
  return {
    say: `I couldn't read the document (${detail}). ${copy.reseat}`,
    note: copy.reseat,
  };
}

/** The second identifier after a scanned card or slip; typed on screen, never kept in the draft. */
const BIRTH_DATE_ASK: Ask = {
  id: "dateOfBirth",
  type: "text",
  question: "To make sure it's you, what is your date of birth?",
  placeholder: "DD/MM/YYYY",
};

/** "23/07/1988", "23-7-1988", "1988-07-23" or "23071988" as "1988-07-23"; null when it isn't a date. */
function birthDateIso(answer: string | undefined): string | null {
  const text = answer?.trim() ?? "";
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const dmy = /^(\d{1,2})[/.\s-](\d{1,2})[/.\s-](\d{4})$/.exec(text) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(text);
  const parts = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null;
  if (!parts) return null;
  const [year, month, day] = parts;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

const SCANNED_LABEL: Record<string, string> = {
  patientCard: "patient card",
  appointmentSlip: "appointment slip",
};

function biometricRetry(note: string): Ask {
  return { ...BIOMETRIC_ASK, note: sentence(note), noteTone: "alert" };
}

function insertDocumentRetry(read: { body: unknown }, detail: string): { say: string; ask: Ask } {
  const reason = (read.body as { reason?: string } | null)?.reason;
  const { say, note } = readerRetry(reason, detail);
  return { say, ask: { ...INSERT_DOCUMENT_ASK, note, noteTone: "alert" } };
}

/** The face check, with the remove-your-card note attached. A stood-in read
 *  gets no note: there is no reader, and no card in it. */
type ReadDocument = {
  documentType: string;
  documentNumber: string;
  holderName: string;
  simulated?: boolean;
  via?: "paper";
};

/** What to take back once the read is done: the card from the reader, or the page from the scanner. */
const takeBack = (doc: Pick<ReadDocument, "via">) => (doc.via === "paper" ? PAPER_TAKE_BACK : idReaderCopy().remove);

function biometricAfterRead(read: Pick<ReadDocument, "simulated" | "via">): Ask {
  if (read.simulated) return BIOMETRIC_ASK;
  return { ...BIOMETRIC_ASK, note: takeBack(read), noteTone: "info" };
}

function readSay(doc: ReadDocument): string {
  const label =
    doc.via === "paper"
      ? "document"
      : doc.documentType === "mykad"
        ? t("identityDocument.spoken.mykad")
        : t("identityDocument.spoken.passport");
  // Last 4 only: the transcript sits on a screen in a public hall and is read aloud.
  const read = `Thank you — I've read your ${label} (${doc.holderName}, ending ${doc.documentNumber.slice(-4)}).`;
  return doc.simulated ? read : `${read} ${takeBack(doc)}`;
}

/** A code or a page only finds the record, so the reply names what was read, never whose it is. */
function scannedSay(doc: Pick<ReadDocument, "documentType" | "via">): string {
  return `Thank you — I've read your ${doc.via === "paper" ? "document" : (SCANNED_LABEL[doc.documentType] ?? "code")}.`;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const ended = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return ended.charAt(0).toUpperCase() + ended.slice(1);
}

/** The identity hand-off before a draft exists: sessionId stays null and the
 *  client echoes serviceId instead. */
function identityStep(
  service: Pick<ServiceDefinition, "id" | "label">,
  say: string,
  asks: Ask[],
  sessionId: string | null = null,
  citizen: FlowResponse["citizen"] = null,
): FlowResponse {
  return {
    status: "need_input",
    sessionId,
    serviceId: service.id,
    serviceLabel: service.label,
    citizen,
    say,
    asks,
    receipt: null,
  };
}

const needsIdentity = (service: ServiceDefinition) => service.flow.includes("identity");

/** Registering: there is no record to identify against yet, so enrolling one stands in for the identity step. */
const enrolls = (service: ServiceDefinition) => service.flow.includes("enroll");

/** A new patient's MyKad, read as a card nobody has registered — see ../self-enrollment. */
const ENROLL_CARD_ASK: Ask = {
  id: "enrollCard",
  type: "action",
  modal: true,
  // Fallback for a terminal with no working reader — see `useCardWatch`.
  autoAdvanceMs: 2_500,
  // Not the identity step's words: those offer a passport, and registering takes a MyKad only.
  question:
    `${idReaderCopy().title}. I'll read your name, IC number and address from its chip, and carry ` +
    "on by myself once it's read.",
};

const DETAILS_CONFIRMED_ASK: Ask = {
  id: "detailsConfirmed",
  type: "options",
  question: "Are these your details?",
  options: [
    { value: "yes", label: "Yes, that's me" },
    { value: "no", label: "No, something is wrong" },
  ],
};

const PORTRAIT_ASK: Ask = {
  id: "portrait",
  type: "action",
  modal: true,
  autoAdvanceMs: BIOMETRIC_SCAN_MS,
  question:
    "Now look at the camera above the screen for your record photo — it takes itself in a " +
    "couple of seconds. It's the face the kiosk will recognise you by next time.",
};

type ReadBackLine = { label: string; value: string };

/**
 * What the patient said before they have a record (a language, an emergency
 * contact), kept for when they do. Never the confirmation: that answers a
 * read-back, and counts only once one has been put to them.
 */
function aheadOfRecord(answers: Record<string, string>): Record<string, string> {
  const ahead = keptAnswers(answers);
  delete ahead.detailsConfirmed;
  return ahead;
}

const readBack = (lines: ReadBackLine[]) =>
  ["This is what your MyKad says:", ...lines.map((line) => `• ${line.label}: ${line.value}`)].join("\n");

/**
 * Registering a new patient: their MyKad is read, they confirm what it says,
 * and their photo is taken. The record that creates is who the rest of the
 * service runs for, already verified — the photo was taken with the card that
 * now opens it.
 *
 * Until the record exists the flow is an open one (./open-sessions): there is
 * nobody yet to keep a draft under. What the card said stays server-side
 * behind a token (see ../self-enrollment); the patient only answers yes or no.
 */
async function enrollFlow(
  service: ServiceDefinition,
  sessionId: string | null,
  data: Record<string, string>,
  answers: Record<string, string>,
): Promise<FlowResponse> {
  const ahead = aheadOfRecord(answers);
  const kept = { ...data, ...ahead };
  const token = kept._enrollment;

  if (!token) {
    if (answers.enrollCard !== "done") {
      return holding(identityStep(service, "Let's read your MyKad first.", [ENROLL_CARD_ASK]), ahead);
    }
    const read = await callRoute(enrollCardRoute);
    if (!read.ok) {
      const reason = (read.body as { reason?: string } | null)?.reason;
      if (reason === "registered") return failure(service.id, service.label, routeError(read, "you're already registered"));
      const { say, note } = readerRetry(reason, routeError(read, "reader unavailable"));
      return holding(identityStep(service, say, [{ ...ENROLL_CARD_ASK, note, noteTone: "alert" }]), ahead);
    }
    const card = read.body as { token: string; lines: ReadBackLine[]; simulated: boolean };
    const id = saveOpenSession(sessionId, service.id, {
      ...kept,
      _enrollment: card.token,
      _enrollLines: JSON.stringify(card.lines),
    });
    const thanks = card.simulated ? "Thank you — I've read your MyKad." : idReaderCopy().remove;
    return identityStep(service, `${thanks}\n\n${readBack(card.lines)}`, [DETAILS_CONFIRMED_ASK], id);
  }

  const lines = JSON.parse(kept._enrollLines ?? "[]") as ReadBackLine[];
  const confirmed = data.detailsConfirmed ?? answers.detailsConfirmed?.trim();
  if (confirmed === "no") {
    discardEnrollment(token);
    if (sessionId) dropOpenSession(sessionId);
    return failure(service.id, service.label, SEE_THE_COUNTER);
  }
  if (confirmed !== "yes") {
    const id = saveOpenSession(sessionId, service.id, kept);
    return identityStep(service, readBack(lines), [DETAILS_CONFIRMED_ASK], id);
  }
  const id = saveOpenSession(sessionId, service.id, { ...kept, detailsConfirmed: "yes" });
  if (answers.portrait !== "done") {
    return identityStep(service, "Thank you.", [PORTRAIT_ASK], id);
  }

  const made = await callRoute(enrollRoute, { json: { token, image: answers.faceFrame } });
  if (!made.ok) {
    const reason = (made.body as { reason?: string } | null)?.reason;
    const said = sentence(routeError(made, "your record could not be created"));
    if (reason === "no_face" || reason === "several_faces") {
      return identityStep(service, said, [{ ...PORTRAIT_ASK, note: said, noteTone: "alert" }], id);
    }
    dropOpenSession(id);
    if (reason === "expired") {
      return identityStep(service, said, [{ ...ENROLL_CARD_ASK, note: said, noteTone: "alert" }]);
    }
    return failure(service.id, service.label, said);
  }
  dropOpenSession(id);

  const enrolled = made.body as { documentNumber: string; profile: CitizenProfile; portrait: boolean };
  const ctx: ChainContext = {
    service,
    documentNumber: enrolled.documentNumber,
    profile: enrolled.profile,
    data: {
      ...Object.fromEntries(Object.entries(kept).filter(([key]) => !isInternalKey(key))),
      consentAt: new Date().toISOString(),
      detailsConfirmed: "yes",
      // No camera, no photo: the counter takes it before the card is printed.
      ...(enrolled.portrait ? {} : { portraitTaken: "no" }),
    },
    notes: [],
  };
  const requestId = await saveDraft(ctx, {}, "enroll").catch(() => null);
  if (!requestId) {
    return failure(
      service.id,
      service.label,
      "Your record was created, but the kiosk couldn't carry on from here — please see the registration counter to finish.",
    );
  }
  ctx.notes.push(`Welcome, ${enrolled.profile.name.split(" ")[0]} — your patient record is created.`);
  // The photo was taken with the card that now opens this record: the patient is who it says.
  return advance(ctx, {}, requestId, grantVerification(enrolled.documentNumber));
}

/** No patient: the flows that never ask who you are run against nobody's record. */
const NOBODY: CitizenProfile = {
  name: "",
  nationalId: "",
  country: "",
  age: 0,
  dateOfBirth: "",
  phone: "",
  email: "",
  address: "",
};

/** A service open to anyone, from its first question; nothing is read or kept about the person asking. */
function openFlow(service: ServiceDefinition, data: Record<string, string> = {}, sessionId: string | null = null) {
  const ctx: ChainContext = { service, documentNumber: "", profile: NOBODY, data, notes: [] };
  return advance(ctx, {}, sessionId, undefined);
}

/** A patient still signed in from their last service: straight to this one, no card. */
async function signedInFlow(
  service: ServiceDefinition,
  documentNumber: string,
  token: string,
  answers: Record<string, string> = {},
): Promise<FlowResponse | null> {
  const citizen = await findCitizenByDocument(documentNumber);
  if (!citizen) return null;
  const ctx: ChainContext = {
    service,
    documentNumber,
    profile: toProfile(citizen),
    data: { consentAt: new Date().toISOString() },
    notes: [],
  };
  mergeAnswers(ctx, answers);
  const requestId = await saveDraft(ctx, {}, "identity").catch(() => null);
  if (!requestId) return null;
  ctx.notes.push(`You're still signed in, ${ctx.profile.name.split(" ")[0]}, so there's no need to scan your card again.`);
  return advance(ctx, {}, requestId, token);
}

/** `answers`: what the patient already said the service will ask ("with Dr Lim on Thursday"), kept until the flow gets there. */
export async function startFlow(
  serviceId: string,
  signIn?: string | null,
  answers: Record<string, string> = {},
): Promise<FlowResponse> {
  const service = getService(serviceId);
  if (!service) {
    return failure(serviceId, serviceId, `There is no service "${serviceId}" at this kiosk.`);
  }
  if (enrolls(service)) {
    if (signIn && verifiedHolder(signIn)) {
      return {
        ...identityStep(service, "You're already registered with us — and signed in, so just tell me what you need.", []),
        status: "completed",
      };
    }
    const ahead = aheadOfRecord(answers);
    return holding(
      identityStep(
        service,
        `${service.label} — I'll register you step by step. First I'll read your MyKad: tapping it means ` +
          "you agree to the kiosk using its details to create your patient record.",
        [ENROLL_CARD_ASK],
      ),
      ahead,
    );
  }
  if (!needsIdentity(service)) return openFlow(service, keptAnswers(answers));
  const holder = signIn ? verifiedHolder(signIn) : null;
  const resumed = holder && signIn ? await signedInFlow(service, holder, signIn, answers) : null;
  if (resumed) return resumed;
  return holding(
    identityStep(
      service,
      `${service.label} — I'll walk you through it step by step. First, let's confirm who you are.`,
      [INSERT_DOCUMENT_ASK],
    ),
    answers,
  );
}

/** Answers off the client that may enter the flow data — never a physical step's, an internal key, or the date of birth. */
function keptAnswers(answers: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (PHYSICAL_STEP_ANSWERS.has(key) || isInternalKey(key) || key === BIRTH_DATE_ASK.id) continue;
    const trimmed = String(value ?? "").trim();
    if (trimmed) kept[key] = trimmed;
  }
  return kept;
}

function mergeAnswers(ctx: ChainContext, answers: Record<string, string>): void {
  Object.assign(ctx.data, keptAnswers(answers));
}

/** Before the card is read there is no draft to keep answers in, so they ride on the response — see `FlowResponse.heldAnswers`. */
function holding(flow: FlowResponse, answers: Record<string, string>): FlowResponse {
  const held = keptAnswers(answers);
  return Object.keys(held).length > 0 ? { ...flow, heldAnswers: held } : flow;
}

export async function continueFlow(args: ContinueFlowArgs): Promise<FlowResponse> {
  const answers = args.answers ?? {};

  if (isOpenSession(args.sessionId)) {
    const open = readOpenSession(args.sessionId);
    const service = open ? getService(open.serviceId) : null;
    if (!open || !service) {
      return failure(args.serviceId ?? "", "Kiosk services", "That request has expired — tell me again what you need.");
    }
    if (enrolls(service)) return enrollFlow(service, args.sessionId, open.data, answers);
    const ctx: ChainContext = { service, documentNumber: "", profile: NOBODY, data: { ...open.data }, notes: [] };
    mergeAnswers(ctx, answers);
    return advance(ctx, {}, args.sessionId, undefined);
  }

  // Identity hand-off, part 1: read the document; its number keys the draft.
  if (!args.sessionId) {
    const service = args.serviceId ? getService(args.serviceId) : null;
    if (!service) {
      return failure("", "Kiosk services", "No active request — tell me which service you need.");
    }
    if (enrolls(service)) return enrollFlow(service, null, {}, answers);
    if (!needsIdentity(service)) {
      const ctx: ChainContext = { service, documentNumber: "", profile: NOBODY, data: {}, notes: [] };
      mergeAnswers(ctx, answers);
      return openFlow(service, ctx.data);
    }
    const holder = args.signIn ? verifiedHolder(args.signIn) : null;
    const resumed = holder && args.signIn ? await signedInFlow(service, holder, args.signIn, answers) : null;
    if (resumed) return resumed;
    if (answers.insertDocument !== "done") {
      return holding(identityStep(service, "Let's confirm who you are first.", [INSERT_DOCUMENT_ASK]), answers);
    }
    const read = await callRoute(readIdDocumentRoute);
    if (!read.ok) {
      const again = insertDocumentRetry(read, routeError(read, "reader unavailable"));
      return holding(identityStep(service, again.say, [again.ask]), answers);
    }
    const doc = read.body as ReadDocument & { secondFactor?: "face" | "dob"; appointmentReference?: string };
    const byBirthDate = doc.secondFactor === "dob";
    const saved = await callRoute(requestsPostRoute, {
      json: {
        serviceId: service.id,
        documentNumber: doc.documentNumber,
        stepId: "identity",
        stepIndex: service.flow.indexOf("identity") + 1,
        data: {
          ...keptAnswers(answers),
          ...(byBirthDate
            ? { _identity: "dob", ...(doc.appointmentReference ? { appointmentReference: doc.appointmentReference } : {}) }
            : {}),
        },
        documents: {},
      },
    });
    if (!saved.ok) {
      return failure(service.id, service.label, routeError(saved, "the flow could not be saved"));
    }
    if (byBirthDate) {
      // Nothing naming the patient until the date of birth matches: a slip can be someone else's.
      return identityStep(
        service,
        scannedSay(doc),
        [BIRTH_DATE_ASK],
        (saved.body as { requestId: string }).requestId,
      );
    }
    return identityStep(
      service,
      readSay(doc),
      [biometricAfterRead(doc)],
      (saved.body as { requestId: string }).requestId,
      { name: doc.holderName, documentNumber: doc.documentNumber },
    );
  }

  // The token, not the draft, is what says the citizen has verified — see
  // ./verified-sessions.
  const { requestId, token } = splitSession(args.sessionId);
  const draft = await cmsFindOne<DraftDoc>("requests", { requestId: { equals: requestId } });
  if (!draft) {
    return failure(
      "",
      "Kiosk services",
      `Session ${requestId} was not found — it may have been submitted or discarded. ` +
        "Start the service again.",
    );
  }
  const service = getService(draft.serviceId);
  if (!service) {
    return failure(draft.serviceId, draft.serviceId, "This saved request's service no longer exists.");
  }
  const citizen = await findCitizenByDocument(draft.documentNumber);
  if (!citizen) {
    return failure(service.id, service.label, "The citizen record for this session no longer exists.");
  }

  const ctx: ChainContext = {
    service,
    documentNumber: draft.documentNumber,
    profile: toProfile(citizen),
    // Internal keys are dropped: older drafts hold a persisted identity flag
    // that must not carry into an application record.
    data: Object.fromEntries(
      Object.entries(draft.data ?? {}).filter(([key]) => !isInternalKey(key)),
    ),
    notes: [],
  };
  const citizenRef = { name: ctx.profile.name, documentNumber: ctx.documentNumber };

  // Identity hand-off, part 2: the biometric scan. A draft on its own never
  // counts as verified — only a live grant issued to this citizen does.
  let session = verificationHolds(token, draft.documentNumber) ? token : undefined;
  if (!session && draft.data?._identity === "dob") {
    const dateOfBirth = birthDateIso(answers.dateOfBirth);
    if (!dateOfBirth) {
      return identityStep(
        service,
        answers.dateOfBirth ? "Please give your date of birth as day, month and year." : "Your identity still needs to be confirmed.",
        [BIRTH_DATE_ASK],
        requestId,
      );
    }
    const verify = await callRoute(verifyIdentityRoute, {
      json: { method: "dob", documentNumber: draft.documentNumber, dateOfBirth },
    });
    if (!verify.ok) {
      const reason = (verify.body as { reason?: string } | null)?.reason;
      const said = routeError(verify, "those details don't match our records");
      if (reason === "locked") {
        await discardDraft(requestId);
        return failure(service.id, service.label, sentence(said));
      }
      return identityStep(service, sentence(said), [{ ...BIRTH_DATE_ASK, note: sentence(said), noteTone: "alert" }], requestId);
    }
    ctx.profile = (verify.body as { profile: CitizenProfile }).profile;
    session = grantVerification(draft.documentNumber);
    ctx.data.consentAt = new Date().toISOString();
    ctx.notes.push(
      `Thank you, ${ctx.profile.name.split(" ")[0]} — that matches. By continuing you consent to this ` +
        `kiosk processing your record for ${service.label}.`,
    );
  }
  if (!session) {
    const method = biometricMethod(answers.biometric);
    if (method === "fingerprint") {
      return identityStep(
        service,
        "The thumbprint scanner is not supported for now — please use the face scan instead.",
        [BIOMETRIC_ASK],
        requestId,
        citizenRef,
      );
    }
    if (method !== "face") {
      return identityStep(
        service,
        "Your identity still needs to be verified before we continue.",
        [BIOMETRIC_ASK],
        requestId,
        citizenRef,
      );
    }
    const verify = await callRoute(verifyIdentityRoute, {
      json: { method, documentNumber: draft.documentNumber, image: answers.faceFrame },
    });
    if (!verify.ok) {
      return identityStep(
        service,
        `The ${method} scan didn't match (${routeError(verify, "please try again")}). Let's try again.`,
        [biometricRetry(routeError(verify, "please try again"))],
        requestId,
        citizenRef,
      );
    }
    ctx.profile = (verify.body as { profile: CitizenProfile }).profile;
    // The check ran and passed: the only place a grant is minted for a flow.
    session = grantVerification(draft.documentNumber);
    ctx.data.consentAt = new Date().toISOString();
    ctx.notes.push(
      `Identity verified — welcome, ${ctx.profile.name}. By continuing you consent to this ` +
        `kiosk processing your registry data for ${service.label}.`,
    );
  }

  mergeAnswers(ctx, answers);

  const documents: UploadedDocuments = { ...(draft.documents ?? {}) };
  for (const upload of args.uploads ?? []) {
    await applyUpload(ctx, documents, upload);
  }
  return advance(ctx, documents, requestId, session, answers);
}

function findRequirement(service: ServiceDefinition, documentId: string) {
  const direct = service.documents.find((doc) => doc.id === documentId);
  if (direct) return { requirement: direct, parent: null };
  const parent = service.documents.find((doc) => doc.relationshipProof?.id === documentId);
  if (parent) return { requirement: parent.relationshipProof!, parent };
  return null;
}

async function applyUpload(
  ctx: ChainContext,
  documents: UploadedDocuments,
  upload: FlowUpload,
): Promise<void> {
  const found = findRequirement(ctx.service, upload.documentId);
  if (!found) {
    ctx.notes.push(`This service has no document requirement "${upload.documentId}".`);
    return;
  }
  const { requirement, parent } = found;

  let bytes: Buffer;
  if (upload.fileBase64) {
    bytes = Buffer.from(upload.fileBase64, "base64");
  } else if (upload.filePath) {
    try {
      bytes = await readFile(upload.filePath);
    } catch {
      ctx.notes.push(`Could not read a document at "${upload.filePath}".`);
      return;
    }
  } else {
    ctx.notes.push(`The upload for ${requirement.label} carried no file.`);
    return;
  }

  const form = new FormData();
  form.set("serviceId", ctx.service.id);
  form.set("documentId", requirement.id);
  form.set("documentNumber", ctx.documentNumber);
  // A relationship proof must name both the applicant and the original holder.
  const relatedName = parent ? documents[parent.id]?.analysis?.holderName : null;
  if (relatedName) form.set("relatedName", relatedName);
  const fileName =
    upload.fileName ?? (upload.filePath ? path.basename(upload.filePath) : `${requirement.id}.pdf`);
  form.set("file", new File([new Uint8Array(bytes)], fileName, {
    type: documentMimeType(fileName) ?? "application/octet-stream",
  }));

  const res = await callRoute(documentsRoute, { form });
  if (!res.ok) {
    ctx.notes.push(
      `The upload for ${requirement.label} failed: ${routeError(res, "please try again")}.`,
    );
    return;
  }
  const stored = res.body as UploadedDocument;
  documents[requirement.id] = stored;
  // The new address is read off the proof, never typed — and only off an accepted one.
  if (requirement.addressField && isAccepted(stored) && stored.analysis?.address) {
    ctx.data[requirement.addressField] = stored.analysis.address;
  }
}

/** Document asks for every requirement not yet satisfied. */
function documentAsks(ctx: ChainContext, documents: UploadedDocuments): Ask[] {
  const asks: Ask[] = [];
  for (const requirement of ctx.service.documents) {
    const uploaded = documents[requirement.id];
    if (!uploaded) {
      asks.push({
        id: requirement.id,
        type: "document",
        modal: true,
        question: `Please upload your ${requirement.label} (${requirement.hint}) as a PDF or a photo.`,
      });
      continue;
    }
    if (isAccepted(uploaded)) continue;

    // Could not be checked: an outage, not a bad document.
    if (!isRejected(uploaded)) {
      asks.push({
        id: requirement.id,
        type: "document",
        modal: true,
        question:
          `Your ${requirement.label} could not be checked` +
          (uploaded.analysis?.summary ? `: ${uploaded.analysis.summary}` : "") +
          " — please upload it again. If that keeps happening, a staff member at the " +
          "counter will need to process your application.",
      });
      continue;
    }

    const proof = requirement.relationshipProof;
    if (proof && isWrongHolder(uploaded)) {
      const proofUploaded = documents[proof.id];
      if (isAccepted(proofUploaded)) continue;
      const holder = uploaded.analysis?.holderName ?? "another person";
      asks.push({
        id: proof.id,
        type: "document",
        modal: true,
        question:
          `Your ${requirement.label.toLowerCase()} belongs to ${holder}.` +
          (proofUploaded?.analysis?.summary
            ? ` The relationship proof was not accepted: ${proofUploaded.analysis.summary}`
            : "") +
          ` If ${holder} is your parent or child, upload a ${proof.label} (${proof.hint}) as a ` +
          `PDF — otherwise upload a ${requirement.label} in your own name instead.`,
      });
      continue;
    }
    asks.push({
      id: requirement.id,
      type: "document",
      modal: true,
      question:
        `Your ${requirement.label} could not be verified` +
        (uploaded.analysis?.summary ? `: ${uploaded.analysis.summary}` : "") +
        ` — please upload the correct document (${requirement.hint}) as a PDF or a photo.`,
    });
  }
  return asks;
}

async function saveDraft(
  ctx: ChainContext,
  documents: UploadedDocuments,
  stepId: string,
  openId: string | null = null,
): Promise<string> {
  if (!ctx.documentNumber) return saveOpenSession(openId, ctx.service.id, ctx.data);
  const res = await callRoute(requestsPostRoute, {
    json: {
      serviceId: ctx.service.id,
      documentNumber: ctx.documentNumber,
      stepId,
      stepIndex: ctx.service.flow.indexOf(stepId) + 1,
      data: ctx.data,
      documents,
    },
  });
  if (!res.ok) throw new Error(routeError(res, "the flow state could not be saved"));
  return (res.body as { requestId: string }).requestId;
}

async function discardDraft(requestId: string | null): Promise<void> {
  if (!requestId) return;
  if (isOpenSession(requestId)) return dropOpenSession(requestId);
  await callRoute(requestsDeleteRoute, { method: "DELETE", params: { requestId } });
}

function paymentInstruction(method: string, amount: string): string {
  switch (method) {
    case "card":
      return `Please tap, insert or swipe your card on the payment terminal to pay ${amount}.`;
    case "qr":
      return `Please scan the QR code shown on the kiosk with your phone and approve the payment of ${amount}.`;
    default:
      return `Please insert cash notes into the acceptor below — ${amount}.`;
  }
}

/** Mock detection time for the payment terminal, per method. */
function paymentDetectMs(method: string): number {
  return method === "qr" ? 4_500 : method === "cash" ? 3_500 : 2_500;
}

/** What the patient takes away from a filed case, for the chat's receipt card. Answers stay out: a phone number or an emergency contact is not a souvenir. */
const TAKEAWAY_KEYS = [
  "queueNumber",
  "department",
  "appointmentReference",
  "date",
  "time",
  "doctor",
  "doctorName",
  "slipCode",
  "mrn",
  "counter",
  "collectAt",
  "invoiceIds",
  "paidTotal",
] as const;

function takeaway(data: Record<string, string>): Record<string, string> {
  return Object.fromEntries(TAKEAWAY_KEYS.filter((key) => data[key]).map((key) => [key, data[key]]));
}

async function advance(
  ctx: ChainContext,
  documents: UploadedDocuments,
  requestId: string | null,
  /** The live verification grant, folded back into every sessionId returned. */
  token: string | undefined,
  confirmations: Record<string, string> = {},
): Promise<FlowResponse> {
  const result = await advanceFlow(ctx, documents, requestId, token, confirmations);
  // The grant rides on every answer to a verified patient, so their next service can skip the card.
  return token && ctx.documentNumber && verificationHolds(token, ctx.documentNumber)
    ? { ...result, signIn: { token, name: ctx.profile.name } }
    : result;
}

async function advanceFlow(
  ctx: ChainContext,
  documents: UploadedDocuments,
  requestId: string | null,
  token: string | undefined,
  confirmations: Record<string, string>,
): Promise<FlowResponse> {
  const { service } = ctx;
  const session = (id: string | null) => (id ? joinSession(id, token) : null);
  try {
    // Duplicate guard: a case still under review blocks a second submission
    // (repeatable services exempt). Nobody to hold one against in an open flow.
    if (!service.repeatable && ctx.documentNumber) {
      const existing = await callRoute(requestsGetRoute, {
        params: { documentNumber: ctx.documentNumber, serviceId: service.id },
      });
      const today = new Date().toDateString();
      const pending = existing.ok
        ? (
            existing.body as {
              requests: { kind: string; status: string; reference: string; updatedAt: string }[];
            }
          ).requests.find(
            (r) =>
              r.kind === "pending" &&
              (r.status === "in_review" || r.status === "officer_review") &&
              (!service.oncePerDay || new Date(r.updatedAt).toDateString() === today),
          )
        : undefined;
      if (pending) {
        await discardDraft(requestId);
        const covered = await (await chainFor(service.id))?.duplicate?.(ctx);
        return response(ctx, null, {
          status: covered ? "completed" : "failed",
          say:
            covered ??
            `Case ${pending.reference} for ${service.label} is already pending review — ` +
              "please wait for it to be completed rather than applying again. You can track " +
              "it under Requests.",
        });
      }
    }

    // Application phase: the planner lives beside its service definition in
    // the country pack.
    const spec = (await chainFor(service.id)) ?? {};
    if (service.flow.includes("application") && spec.application) {
      const plan = await spec.application(ctx);
      if (plan.kind === "halt") {
        await discardDraft(requestId);
        return response(ctx, null, { status: "failed", say: plan.reason });
      }
      if (plan.kind === "done") {
        await discardDraft(requestId);
        return response(ctx, null, { status: "completed", say: plan.message, route: plan.route });
      }
      if (plan.kind === "ask") {
        const sid = await saveDraft(ctx, documents, "application", requestId);
        return response(ctx, session(sid), {
          status: "need_input",
          say: plan.say ?? "I need a few details to continue.",
          asks: plan.asks,
        });
      }
      if (spec.finalize) Object.assign(ctx.data, spec.finalize(ctx));
    }

    // Documents phase.
    if (service.flow.includes("documents") && service.documents.length > 0) {
      const asks = documentAsks(ctx, documents);
      if (asks.length > 0) {
        const sid = await saveDraft(ctx, documents, "documents", requestId);
        return response(ctx, session(sid), {
          status: "need_input",
          say:
            `${service.label} needs ${asks.length > 1 ? "these documents" : "a document"} — ` +
            "each upload is verified against your identity.",
          asks,
        });
      }
    }

    // Payment phase.
    const quote = await fetchQuote(service.id, ctx.data);
    const method = ctx.data.paymentMethod;
    if (quote.total > 0 && !PAYMENT_METHODS.includes(method as (typeof PAYMENT_METHODS)[number])) {
      const sid = await saveDraft(ctx, documents, "payment", requestId);
      return response(ctx, session(sid), {
        status: "need_input",
        say: "Everything is in order — the last step is payment.",
        asks: [
          {
            id: "paymentMethod",
            type: "options",
            question:
              `The total is ${formatMoney(quote.total, quote.currency)}` +
              (quote.processingFee > 0
                ? ` (${formatMoney(quote.serviceFee, quote.currency)} service fee + ` +
                  `${formatMoney(quote.processingFee, quote.currency)} kiosk processing fee)`
                : "") +
              ". How would you like to pay?",
            options: [
              { value: "card", label: "Card — tap, insert or swipe" },
              { value: "qr", label: "QR / e-Wallet — scan with your phone" },
              { value: "cash", label: "Cash — insert notes at the kiosk" },
            ],
          },
        ],
      });
    }

    if (quote.total > 0 && method && confirmations.payment !== "done") {
      const sid = await saveDraft(ctx, documents, "payment", requestId);
      return response(ctx, session(sid), {
        status: "need_input",
        say: "Ready to pay.",
        asks: [
          {
            id: "payment",
            type: "action",
            modal: true,
            autoAdvanceMs: paymentDetectMs(method),
            question: paymentInstruction(method, formatMoney(quote.total, quote.currency)),
          },
        ],
      });
    }

    type PaymentReceipt = { paymentId: string; amount: number; currency: string; method: string };
    let payment: PaymentReceipt | null = null;
    if (quote.total > 0) {
      const paid = await callRoute(paymentsRoute, {
        json: {
          serviceId: service.id,
          method,
          data: ctx.data,
          documentNumber: ctx.documentNumber,
        },
      });
      if (!paid.ok) {
        return response(ctx, session(requestId), {
          status: "failed",
          say: `Payment failed: ${routeError(paid, "please try again")}.`,
        });
      }
      payment = paid.body as PaymentReceipt;
    }

    // Submission.
    const submitted = await callRoute(applicationsRoute, {
      json: {
        serviceId: service.id,
        paymentId: payment?.paymentId,
        documentNumber: ctx.documentNumber,
        data: ctx.data,
      },
    });
    if (!submitted.ok) {
      return response(ctx, session(requestId), {
        status: "failed",
        say: `The application could not be submitted: ${routeError(submitted, "please try again")}.`,
      });
    }
    const application = submitted.body as {
      caseId: string;
      status: string;
      statusReason: string | null;
      submittedAt: string;
      data?: Record<string, string>;
    };
    const filedData = { ...ctx.data, ...application.data };
    const filedLine =
      (await spec.filed?.({
        caseId: application.caseId,
        status: application.status,
        data: filedData,
        documentNumber: ctx.documentNumber,
      })) ?? "";

    const paymentLine = payment
      ? `Payment of ${formatMoney(payment.amount, payment.currency)} received by ${payment.method} ` +
        `(${payment.paymentId}).`
      : "No fee was payable.";
    const statusLine =
      application.status === "approved"
        ? `Done — case ${application.caseId}: ${application.statusReason ?? "completed"}.`
        : application.status === "on_hold"
        ? `Your application was recorded as case ${application.caseId} but is ON HOLD: ` +
          `${application.statusReason ?? "see kiosk staff."}`
        : application.status === "officer_review"
          ? `Submitted — case ${application.caseId}. ` +
            `${application.statusReason ?? "It has been routed for officer review."}`
          : `Submitted successfully — case ${application.caseId} is in review. ` +
            "You can track it under Requests at any kiosk.";

    return response(ctx, null, {
      status: "completed",
      say: [paymentLine, statusLine, filedLine].filter(Boolean).join(" "),
      receipt: {
        caseId: application.caseId,
        status: application.status,
        statusReason: application.statusReason,
        submittedAt: application.submittedAt,
        payment,
        takeaway: takeaway(filedData),
      },
      route: application.status === "on_hold" ? undefined : spec.route?.(filedData),
    });
  } catch (error) {
    return response(ctx, session(requestId), {
      status: "failed",
      say: `Something went wrong: ${error instanceof Error ? error.message : "unknown error"}. Please try again.`,
    });
  }
}

/**
 * The "My Requests" flow. Privacy rule: the citizen verifies identity first,
 * and only requests filed under that verified document number are ever
 * fetched or mentioned.
 */

const REQUESTS_SERVICE = { id: REQUESTS_FLOW_ID, label: "My Requests" };

type RequestListRow = {
  kind: "saved" | "pending";
  reference: string;
  serviceLabel: string;
  status: string;
  statusReason: string | null;
  stepId: string | null;
  updatedAt: string;
};

const PENDING_STATUS_LABELS: Record<string, string> = {
  in_review: "in review",
  officer_review: "with an officer for review",
  on_hold: "on hold",
};

function requestsResponse(
  citizen: FlowResponse["citizen"],
  partial: Pick<FlowResponse, "status" | "say"> & Partial<FlowResponse>,
  sessionId: string | null = null,
): FlowResponse {
  return {
    sessionId,
    serviceId: REQUESTS_SERVICE.id,
    serviceLabel: REQUESTS_SERVICE.label,
    citizen,
    asks: [],
    receipt: null,
    ...partial,
  };
}

export async function startRequestsFlow(signIn?: string | null): Promise<FlowResponse> {
  const holder = signIn ? verifiedHolder(signIn) : null;
  const citizen = holder ? await findCitizenByDocument(holder) : null;
  if (citizen && signIn) {
    return listRequests({ name: citizen.name, documentNumber: citizen.citizenId }, signIn, "You're still signed in.");
  }
  return identityStep(
    REQUESTS_SERVICE,
    "I can show you your saved and pending requests. First, let's confirm who you are — " +
      "I can only show requests belonging to the verified cardholder.",
    [INSERT_DOCUMENT_ASK],
  );
}

export async function continueRequestsFlow(args: {
  answers?: Record<string, string>;
  citizen?: FlowResponse["citizen"];
  sessionId?: string | null;
  signIn?: string | null;
}): Promise<FlowResponse> {
  const answers = args.answers ?? {};
  const citizen = args.citizen ?? null;
  // `citizen` is client-echoed state — a claim, not a fact. The grant is the
  // fact, checked against the very document number being claimed.
  const token = args.sessionId ?? args.signIn ?? undefined;
  const verified = Boolean(citizen) && verificationHolds(token, citizen?.documentNumber ?? "");

  if (!citizen && args.signIn && verifiedHolder(args.signIn) && !answers.resumeRequest) {
    return startRequestsFlow(args.signIn);
  }

  // Resume pick: only for a citizen verified on this session, and only for a
  // draft filed under their own identity.
  if (verified && citizen && answers.resumeRequest) {
    if (answers.resumeRequest === "none") {
      return requestsResponse(citizen, {
        status: "completed",
        say: "Alright — your requests are kept safe. Tell me if there's anything else you need.",
      });
    }
    const draft = await cmsFindOne<DraftDoc>("requests", {
      requestId: { equals: answers.resumeRequest },
      documentNumber: { equals: citizen.documentNumber },
    });
    if (!draft) {
      return failure(
        REQUESTS_SERVICE.id,
        REQUESTS_SERVICE.label,
        "That saved request isn't filed under your identity — it may have been submitted " +
          "or discarded in the meantime.",
      );
    }
    return continueFlow({ sessionId: joinSession(draft.requestId, token) });
  }

  // Stage 1: read the ID document to learn who is asking.
  if (!citizen) {
    if (answers.insertDocument !== "done") {
      return identityStep(REQUESTS_SERVICE, "Let's confirm who you are first.", [
        INSERT_DOCUMENT_ASK,
      ]);
    }
    const read = await callRoute(readIdDocumentRoute);
    if (!read.ok) {
      const again = insertDocumentRetry(read, routeError(read, "reader unavailable"));
      return identityStep(REQUESTS_SERVICE, again.say, [again.ask]);
    }
    const doc = read.body as ReadDocument & { secondFactor?: "face" | "dob" };
    if (doc.secondFactor === "dob") {
      // Nothing naming the patient until the date of birth matches.
      return identityStep(
        REQUESTS_SERVICE,
        scannedSay(doc),
        [BIRTH_DATE_ASK],
        null,
        { name: "", documentNumber: doc.documentNumber },
      );
    }
    return identityStep(
      REQUESTS_SERVICE,
      readSay(doc),
      [biometricAfterRead(doc)],
      null,
      { name: doc.holderName, documentNumber: doc.documentNumber },
    );
  }

  // Stage 2, scanned code: the date of birth confirms it.
  if (!citizen.name) {
    const dateOfBirth = birthDateIso(answers.dateOfBirth);
    if (!dateOfBirth) {
      return identityStep(REQUESTS_SERVICE, "Your identity still needs to be confirmed.", [BIRTH_DATE_ASK], null, citizen);
    }
    const verify = await callRoute(verifyIdentityRoute, {
      json: { method: "dob", documentNumber: citizen.documentNumber, dateOfBirth },
    });
    if (!verify.ok) {
      const said = sentence(routeError(verify, "those details don't match our records"));
      if ((verify.body as { reason?: string } | null)?.reason === "locked") {
        return failure(REQUESTS_SERVICE.id, REQUESTS_SERVICE.label, said);
      }
      return identityStep(REQUESTS_SERVICE, said, [{ ...BIRTH_DATE_ASK, note: said, noteTone: "alert" }], null, citizen);
    }
    const profile = (verify.body as { profile: CitizenProfile }).profile;
    const holder = { name: profile.name, documentNumber: citizen.documentNumber };
    return listRequests(holder, grantVerification(holder.documentNumber), `Thank you, ${profile.name.split(" ")[0]} — that matches.`);
  }

  // Stage 2: biometric match — nothing is listed until this succeeds.
  const method = biometricMethod(answers.biometric);
  if (method === "fingerprint") {
    return identityStep(
      REQUESTS_SERVICE,
      "The thumbprint scanner is not supported for now — please use the face scan instead.",
      [BIOMETRIC_ASK],
      null,
      citizen,
    );
  }
  if (method !== "face") {
    return identityStep(
      REQUESTS_SERVICE,
      "Your identity still needs to be verified before I can show your requests.",
      [BIOMETRIC_ASK],
      null,
      citizen,
    );
  }
  const verify = await callRoute(verifyIdentityRoute, {
    json: { method, documentNumber: citizen.documentNumber, image: answers.faceFrame },
  });
  if (!verify.ok) {
    return identityStep(
      REQUESTS_SERVICE,
      `The ${method} scan didn't match (${routeError(verify, "please try again")}). Let's try again.`,
      [biometricRetry(routeError(verify, "please try again"))],
      null,
      citizen,
    );
  }
  const profile = (verify.body as { profile: CitizenProfile }).profile;
  const holder = { name: profile.name, documentNumber: citizen.documentNumber };
  // The check passed: mint the grant; it rides back as the flow's sessionId.
  return listRequests(holder, grantVerification(holder.documentNumber), `Identity verified — welcome, ${holder.name}.`);
}

/** Verified — this patient's requests and nobody else's. */
async function listRequests(
  holder: { name: string; documentNumber: string },
  granted: string,
  greeting: string,
): Promise<FlowResponse> {
  const signIn = { token: granted, name: holder.name };
  const res = await callRoute(requestsGetRoute, {
    params: { documentNumber: holder.documentNumber },
  });
  if (!res.ok) {
    return failure(
      REQUESTS_SERVICE.id,
      REQUESTS_SERVICE.label,
      `I couldn't load your requests (${routeError(res, "please try again")}).`,
    );
  }
  const rows = (res.body as { requests: RequestListRow[] }).requests;
  const saved = rows.filter((r) => r.kind === "saved");
  const pending = rows.filter((r) => r.kind === "pending");

  const lines = [greeting];
  if (rows.length === 0) {
    lines.push(
      "You have no saved or pending requests. Tell me which service you need and I can " +
        "start a new application.",
    );
    return requestsResponse(holder, { status: "completed", say: lines.join("\n\n"), signIn }, granted);
  }
  if (saved.length > 0) {
    lines.push(
      "Saved applications you can resume:\n" +
        saved
          .map(
            (r) =>
              `• ${r.reference} — ${r.serviceLabel}, paused at the ${r.stepId} step ` +
              `(saved ${formatDateTime(r.updatedAt)})`,
          )
          .join("\n"),
    );
  }
  if (pending.length > 0) {
    lines.push(
      "Submitted and pending review:\n" +
        pending
          .map(
            (r) =>
              `• ${r.reference} — ${r.serviceLabel}, ` +
              `${PENDING_STATUS_LABELS[r.status] ?? r.status}` +
              `${r.statusReason ? ` — ${r.statusReason}` : ""}`,
          )
          .join("\n"),
    );
  }
  if (saved.length === 0) {
    return requestsResponse(holder, { status: "completed", say: lines.join("\n\n"), signIn }, granted);
  }
  return requestsResponse(
    holder,
    {
      status: "need_input",
      say: lines.join("\n\n"),
      signIn,
      asks: [
        {
          id: "resumeRequest",
          type: "options",
          question: "Would you like to resume one of your saved applications?",
          options: [
            ...saved.map((r) => ({ value: r.reference, label: `Resume ${r.serviceLabel}` })),
            { value: "none", label: "Not now" },
          ],
        },
      ],
    },
    granted,
  );
}
