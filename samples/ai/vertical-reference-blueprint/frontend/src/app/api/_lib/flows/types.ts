// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services";

/**
 * Guided service flows ("chains"). A flow runs one kiosk service end to end
 * on the server — identity, registry lookups, eligibility, documents, fee,
 * payment, submission — and only surfaces `need_input` when a human answer
 * is genuinely required. The asks carry ready-to-relay question text and
 * enumerated options so even a very small LLM (or no LLM at all — the chat
 * UI renders them as buttons) can drive a complete application.
 */

/**
 * Pseudo-service id for the "My Requests" flow: verify identity, then list
 * (and optionally resume) only the verified citizen's saved/pending requests.
 * Not a real ServiceDefinition — the chat route dispatches it specially.
 */
export const REQUESTS_FLOW_ID = "requests";

/**
 * What the kiosk says when the citizen answers a physical step with words.
 *
 * "Done", spoken or typed, cannot finish a step that ends at the hardware:
 * the reader has to report a card before there is anything to verify. The
 * chat route replies with this line, and the assistant UI recognises it and
 * folds it into the step card — under the picture of the device, next to a
 * button that does finish the step — rather than leaving it as a bubble that
 * tells the citizen they are stuck without saying what to press.
 */
export const DEVICE_STEP_REPLY =
  "This step happens at the kiosk itself — please follow the on-screen prompt and " +
  "confirm once you've done it.";

export type AskType = "options" | "text" | "document" | "action";

export type AskOption = { value: string; label: string };

export type Ask = {
  /** Answer key: a flow-data field id, "paymentMethod", or (for type
   *  "document") the document requirement id the upload satisfies. */
  id: string;
  /** Ready-to-relay question text. */
  question: string;
  /** "action" is a physical step at the kiosk (insert MyKad, tap card…):
   *  the citizen performs it, then confirms with the answer "done". */
  type: AskType;
  options?: AskOption[];
  /** Example answer, for text asks. */
  placeholder?: string;
  /** May be left unanswered this round (e.g. depends on another answer). */
  optional?: boolean;
  /** Present as a blocking popup/modal that waits for the citizen. */
  modal?: boolean;
  /**
   * For action asks: the kiosk hardware detects completion itself — the UI
   * waits roughly this long (mock detection) and then confirms "done"
   * automatically instead of showing a button.
   */
  autoAdvanceMs?: number;
  /**
   * A line that belongs with this step but is not what it is asking for:
   * why the last attempt was refused, or what to do with the hardware now
   * that the step before it is finished ("take your MyKad back").
   *
   * Carried on the ask rather than left in `say` because the step overlay
   * covers the transcript: the citizen doing the step cannot read the
   * sentence that explains it. Carried as a field rather than pattern-matched
   * back out of `say` because the wording is the flow's to change — and the
   * agentic brain relays `say` in its own words anyway.
   */
  note?: string;
  /** How the note reads: a standing instruction, or a refusal to act on. */
  noteTone?: "info" | "alert";
};

export type ContinueFlowArgs = {
  /** Save/resume draft id — absent only before the ID document is read. */
  sessionId?: string | null;
  /** Required instead of sessionId during the identity hand-off. */
  serviceId?: string | null;
  answers?: Record<string, string>;
  uploads?: FlowUpload[];
};

/** A PDF supplied in answer to a `document` ask. */
export type FlowUpload = {
  documentId: string;
  /** PDF bytes, base64-encoded. */
  fileBase64?: string;
  /**
   * Alternative: absolute path of a PDF on the kiosk machine.
   *
   * Only ever for a caller that IS the kiosk machine — an MCP host running
   * beside it, handing over a file it already has. It is not a channel a
   * browser may use, and `browserUploads` below is what keeps it that way:
   * a path chosen by whoever can reach the terminal is a request to read an
   * arbitrary file off the kiosk and have its text read back.
   */
  filePath?: string;
  fileName?: string;
};

/**
 * Uploads as they arrive from a browser, with the paths taken out.
 *
 * The two chat routes take their uploads from the client's own message
 * metadata, so everything in them is the visitor's to choose. Bytes are fine
 * — that is a file they picked, and it goes through the same store → OCR →
 * verification path a tapped upload does. A `filePath` is not: nothing in the
 * kiosk UI ever sets one, and honouring it would let anyone who can reach the
 * terminal name any file on the machine and read its text back in the
 * verification summary.
 *
 * Dropped silently rather than refused. A browser that sent one is not a
 * citizen who did something wrong, and there is no message worth putting on a
 * kiosk screen about it — the upload simply arrives carrying no file, which
 * the flow engine already answers with "please upload it again".
 */
export function browserUploads(uploads: FlowUpload[] | undefined): FlowUpload[] {
  // Rebuilt field by field rather than spread-minus-filePath: an allowlist
  // stays correct when someone adds another server-side field to FlowUpload,
  // and a denylist quietly stops covering it.
  return (uploads ?? []).map(({ documentId, fileBase64, fileName }) => ({
    documentId,
    fileBase64,
    fileName,
  }));
}

export type FlowReceipt = {
  caseId: string;
  status: string;
  statusReason: string | null;
  submittedAt: string;
  payment: { paymentId: string; amount: number; currency: string; method: string } | null;
};

export type FlowResponse = {
  status: "need_input" | "completed" | "failed";
  /**
   * Echo it back to continue the flow. It carries two things: the draft to
   * resume, and — once the citizen has passed the identity check — the grant
   * that says so (see ../flows/verified-sessions). A sessionId that has lost
   * its grant still finds the draft and asks for the card again, which is
   * what makes a request id on its own harmless.
   */
  sessionId: string | null;
  serviceId: string;
  serviceLabel: string;
  citizen: { name: string; documentNumber: string } | null;
  /** Ready-to-relay message covering everything that just happened. */
  say: string;
  asks: Ask[];
  receipt: FlowReceipt | null;
};

/** Registry profile facts the chains gate options on (from identity verify). */
export type CitizenProfile = {
  name: string;
  nationalId: string;
  country: string;
  age: number;
  religion: string;
  maritalStatus: string;
  monthlyIncome: number;
  isOku: boolean;
  childrenUnder18: number;
  idCardLossCount: number;
  outstandingFines: { count: number; total: number };
  requiresOfficerReview: boolean;
};

export type ChainContext = {
  service: ServiceDefinition;
  documentNumber: string;
  profile: CitizenProfile;
  /** Flow answers so far. Specs may write derived defaults into it. */
  data: Record<string, string>;
  /** Extra lines prepended to the next response's `say`. */
  notes: string[];
};

export type ApplicationPlan =
  /** Human answers still missing. */
  | { kind: "ask"; say?: string; asks: Ask[] }
  /** Registry rules make the citizen ineligible — end without submitting. */
  | { kind: "halt"; reason: string }
  /** Nothing left to do (e.g. no summonses) — end successfully, no case. */
  | { kind: "done"; message: string }
  /** Application data complete — proceed to documents and payment. */
  | { kind: "ready" };

export type ChainSpec = {
  /** Plan the service-specific application step from registry facts. */
  application?: (ctx: ChainContext) => Promise<ApplicationPlan> | ApplicationPlan;
  /** Derived fields written once the application step completes (priceKey…). */
  finalize?: (ctx: ChainContext) => Record<string, string>;
};
