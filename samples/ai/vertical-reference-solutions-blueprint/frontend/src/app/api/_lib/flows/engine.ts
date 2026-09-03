// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { t } from "@/lib/i18n";
import { readFile } from "fs/promises";
import path from "path";
import { getService, type ServiceDefinition } from "@/services";
import { formatDateTime, formatMoney } from "@/lib/format";
import { READER_FAULT_HELP, idReaderCopy, isReaderFault } from "@/lib/id-reader";
import { cmsFindOne } from "../cms";
import { findCitizenByDocument, toProfile } from "../citizens";
import { documentMimeType } from "../media";
import { callRoute, routeError } from "../route-call";
import { POST as applicationsRoute } from "../../applications/route";
import { POST as documentsRoute } from "../../documents/route";
import { GET as readIdDocumentRoute } from "../../identity/document/route";
import { POST as verifyIdentityRoute } from "../../identity/verify/route";
import { POST as paymentsRoute } from "../../payments/route";
import {
  DELETE as requestsDeleteRoute,
  GET as requestsGetRoute,
  POST as requestsPostRoute,
} from "../../requests/route";
import { fetchQuote } from "./bridge";
import { activeChains } from "@/packs/index.server";
import { REQUESTS_FLOW_ID } from "./types";
import {
  grantVerification,
  joinSession,
  splitSession,
  verificationHolds,
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
    citizen: { name: ctx.profile.name, documentNumber: ctx.documentNumber },
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

/** Physical-step confirmations — never merged into the persisted flow data.
 *  `faceFrame` especially: a saved draft must never hold a picture of a citizen. */
const TRANSIENT_ANSWERS = new Set(["insertDocument", "biometric", "faceFrame", "payment"]);

/** Engine-internal flow-data keys. Answers come straight off the client, so
 *  an answer may never write one. */
const isInternalKey = (key: string) => key.startsWith("_");

const INSERT_DOCUMENT_ASK: Ask = {
  id: "insertDocument",
  type: "action",
  modal: true,
  // Fallback for a terminal with no working reader — see `useCardWatch`.
  autoAdvanceMs: 2_500,
  question: idReaderCopy().spoken,
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
    const fault = `${sentence(detail)} ${READER_FAULT_HELP}`;
    return { say: fault, note: fault };
  }
  return {
    say: `I couldn't read the document (${detail}). ${copy.reseat}`,
    note: copy.reseat,
  };
}

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
function biometricAfterRead(read: { simulated?: boolean }): Ask {
  if (read.simulated) return BIOMETRIC_ASK;
  return { ...BIOMETRIC_ASK, note: idReaderCopy().remove, noteTone: "info" };
}

function readSay(doc: { documentType: string; documentNumber: string; holderName: string; simulated?: boolean }): string {
  const label =
    doc.documentType === "mykad"
      ? t("identityDocument.spoken.mykad")
      : t("identityDocument.spoken.passport");
  const read = `Thank you — I've read your ${label} (${doc.documentNumber}, ${doc.holderName}).`;
  return doc.simulated ? read : `${read} ${idReaderCopy().remove}`;
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

export async function startFlow(serviceId: string): Promise<FlowResponse> {
  const service = getService(serviceId);
  if (!service) {
    return failure(serviceId, serviceId, `There is no service "${serviceId}" at this kiosk.`);
  }
  return identityStep(
    service,
    `${service.label} — I'll walk you through it step by step. First, let's confirm who you are.`,
    [INSERT_DOCUMENT_ASK],
  );
}

export async function continueFlow(args: ContinueFlowArgs): Promise<FlowResponse> {
  const answers = args.answers ?? {};

  // Identity hand-off, part 1: read the document; its number keys the draft.
  if (!args.sessionId) {
    const service = args.serviceId ? getService(args.serviceId) : null;
    if (!service) {
      return failure("", "Kiosk services", "No active request — tell me which service you need.");
    }
    if (answers.insertDocument !== "done") {
      return identityStep(service, "Let's confirm who you are first.", [INSERT_DOCUMENT_ASK]);
    }
    const read = await callRoute(readIdDocumentRoute);
    if (!read.ok) {
      const again = insertDocumentRetry(read, routeError(read, "reader unavailable"));
      return identityStep(service, again.say, [again.ask]);
    }
    const doc = read.body as {
      documentType: string;
      documentNumber: string;
      holderName: string;
      simulated?: boolean;
    };
    const saved = await callRoute(requestsPostRoute, {
      json: {
        serviceId: service.id,
        documentNumber: doc.documentNumber,
        stepId: "identity",
        stepIndex: service.flow.indexOf("identity") + 1,
        data: {},
        documents: {},
      },
    });
    if (!saved.ok) {
      return failure(service.id, service.label, routeError(saved, "the flow could not be saved"));
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
    ctx.notes.push(
      `Identity verified — welcome, ${ctx.profile.name}. By continuing you consent to this ` +
        `kiosk processing your registry data for ${service.label}.`,
    );
  }

  for (const [key, value] of Object.entries(answers)) {
    if (TRANSIENT_ANSWERS.has(key) || isInternalKey(key)) continue;
    const trimmed = String(value ?? "").trim();
    if (trimmed) ctx.data[key] = trimmed;
  }

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
        question: `Please upload your ${requirement.label} (${requirement.hint}) as a PDF.`,
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
        ` — please upload the correct document (${requirement.hint}) as a PDF.`,
    });
  }
  return asks;
}

async function saveDraft(
  ctx: ChainContext,
  documents: UploadedDocuments,
  stepId: string,
): Promise<string> {
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

async function advance(
  ctx: ChainContext,
  documents: UploadedDocuments,
  requestId: string | null,
  /** The live verification grant, folded back into every sessionId returned. */
  token: string | undefined,
  confirmations: Record<string, string> = {},
): Promise<FlowResponse> {
  const { service } = ctx;
  const session = (id: string | null) => (id ? joinSession(id, token) : null);
  try {
    // Duplicate guard: a case still under review blocks a second submission
    // (repeatable services exempt).
    if (!service.repeatable) {
      const existing = await callRoute(requestsGetRoute, {
        params: { documentNumber: ctx.documentNumber, serviceId: service.id },
      });
      const pending = existing.ok
        ? (
            existing.body as { requests: { kind: string; status: string; reference: string }[] }
          ).requests.find(
            (r) => r.kind === "pending" && (r.status === "in_review" || r.status === "officer_review"),
          )
        : undefined;
      if (pending) {
        await discardDraft(requestId);
        return response(ctx, null, {
          status: "failed",
          say:
            `Case ${pending.reference} for ${service.label} is already pending review — to ` +
            "avoid a duplicate submission and double payment, please wait for it to be " +
            "completed. You can track it under Requests.",
        });
      }
    }

    // Application phase: the planner lives beside its service definition in
    // the country pack.
    const spec = activeChains()[service.id] ?? {};
    if (service.flow.includes("application") && spec.application) {
      const plan = await spec.application(ctx);
      if (plan.kind === "halt") {
        await discardDraft(requestId);
        return response(ctx, null, { status: "failed", say: plan.reason });
      }
      if (plan.kind === "done") {
        await discardDraft(requestId);
        return response(ctx, null, { status: "completed", say: plan.message });
      }
      if (plan.kind === "ask") {
        const sid = await saveDraft(ctx, documents, "application");
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
        const sid = await saveDraft(ctx, documents, "documents");
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
      const sid = await saveDraft(ctx, documents, "payment");
      return response(ctx, session(sid), {
        status: "need_input",
        say: "Everything is in order — the last step is payment.",
        asks: [
          {
            id: "paymentMethod",
            type: "options",
            question:
              `The total is ${formatMoney(quote.total, quote.currency)} ` +
              `(${formatMoney(quote.serviceFee, quote.currency)} service fee + ` +
              `${formatMoney(quote.processingFee, quote.currency)} kiosk processing fee). ` +
              "How would you like to pay?",
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
      const sid = await saveDraft(ctx, documents, "payment");
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
    };

    const paymentLine = payment
      ? `Payment of ${formatMoney(payment.amount, payment.currency)} received by ${payment.method} ` +
        `(${payment.paymentId}).`
      : "No fee was payable.";
    const statusLine =
      application.status === "on_hold"
        ? `Your application was recorded as case ${application.caseId} but is ON HOLD: ` +
          `${application.statusReason ?? "see kiosk staff."}`
        : application.status === "officer_review"
          ? `Submitted — case ${application.caseId}. ` +
            `${application.statusReason ?? "It has been routed for officer review."}`
          : `Submitted successfully — case ${application.caseId} is in review. ` +
            "You can track it under Requests at any kiosk.";

    return response(ctx, null, {
      status: "completed",
      say: `${paymentLine} ${statusLine}`,
      receipt: { ...application, payment },
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

export async function startRequestsFlow(): Promise<FlowResponse> {
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
}): Promise<FlowResponse> {
  const answers = args.answers ?? {};
  const citizen = args.citizen ?? null;
  // `citizen` is client-echoed state — a claim, not a fact. The grant is the
  // fact, checked against the very document number being claimed.
  const token = args.sessionId ?? undefined;
  const verified = Boolean(citizen) && verificationHolds(token, citizen?.documentNumber ?? "");

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
    const doc = read.body as {
      documentType: string;
      documentNumber: string;
      holderName: string;
      simulated?: boolean;
    };
    return identityStep(
      REQUESTS_SERVICE,
      readSay(doc),
      [biometricAfterRead(doc)],
      null,
      { name: doc.holderName, documentNumber: doc.documentNumber },
    );
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
  const granted = grantVerification(holder.documentNumber);

  // Verified — fetch this citizen's requests and nobody else's.
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

  const lines = [`Identity verified — welcome, ${holder.name}.`];
  if (rows.length === 0) {
    lines.push(
      "You have no saved or pending requests. Tell me which service you need and I can " +
        "start a new application.",
    );
    return requestsResponse(holder, { status: "completed", say: lines.join("\n\n") }, granted);
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
    return requestsResponse(holder, { status: "completed", say: lines.join("\n\n") }, granted);
  }
  return requestsResponse(
    holder,
    {
      status: "need_input",
      say: lines.join("\n\n"),
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
