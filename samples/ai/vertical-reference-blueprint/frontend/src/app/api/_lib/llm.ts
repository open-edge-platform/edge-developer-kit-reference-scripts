// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Document-understanding LLM bridge. With KIOSK_LLM_MOCK=true (default) the
 * verdict is simulated from the OCR text, so no AI service needs to be up.
 * Set KIOSK_LLM_MOCK=false and point KIOSK_LLM_BASE_URL at any
 * OpenAI-compatible chat-completions server (Ollama, llama.cpp, LM Studio,
 * vLLM) to go live. KIOSK_LLM_MOCK=false with no base URL disables analysis.
 */

import { healthCheckEnabled, probeService, type ServiceHealth } from "./health";
import { systemPrompt } from "./prompts";

export type { ServiceHealth };

const MOCK_LLM = (process.env.KIOSK_LLM_MOCK ?? "true") !== "false";
/** Dev knob: set to "mismatch" to preview the check-with-staff warning UI. */
const MOCK_VERDICT = process.env.KIOSK_LLM_MOCK_VERDICT === "mismatch" ? "mismatch" : "match";
const BASE_URL = process.env.KIOSK_LLM_BASE_URL?.replace(/\/$/, "");
const MODEL = process.env.KIOSK_LLM_MODEL ?? "llama3.2";
const API_KEY = process.env.KIOSK_LLM_API_KEY;
const TIMEOUT_MS = Number(process.env.KIOSK_LLM_TIMEOUT_MS ?? 30_000);
/** Probed for liveness; /models is the OpenAI-compatible convention. */
const HEALTH_PATH = process.env.KIOSK_LLM_HEALTH_PATH ?? "/models";
/** Reasoning models spend tokens thinking before the JSON — leave headroom. */
const MAX_TOKENS = Number(process.env.KIOSK_LLM_MAX_TOKENS ?? 2_048);
/**
 * Extra JSON merged into the chat request body, for server-specific options —
 * e.g. {"chat_template_kwargs":{"enable_thinking":false}} to stop Qwen-style
 * models from spending the whole token budget thinking.
 */
const EXTRA_BODY: Record<string, unknown> = (() => {
  try {
    return process.env.KIOSK_LLM_EXTRA_BODY ? JSON.parse(process.env.KIOSK_LLM_EXTRA_BODY) : {};
  } catch {
    return {};
  }
})();
/** Small local models have small contexts — cap the OCR text we send. */
const MAX_TEXT_CHARS = 6_000;

/**
 * Outcome of the check on a captured document.
 *
 * - "accepted"   — the check ran and the document satisfies the requirement.
 * - "rejected"   — the check ran and it does not.
 * - "unverified" — the check could not run at all: OCR or the model was
 *   unavailable, the page carried no readable text, or the model's answer was
 *   unusable.
 *
 * "unverified" is deliberately its own state rather than a missing verdict.
 * A verdict that never arrived used to be indistinguishable from a passing
 * one, so anything the pipeline choked on — an unreadable page, a model that
 * timed out — was waved through unchecked. It is never a pass: the citizen is
 * asked to capture the document again, and staff review it if it persists.
 */
export type DocumentStatus = "accepted" | "rejected" | "unverified";

export type DocumentAnalysis = {
  status: DocumentStatus;
  /**
   * Is the scan at least the right kind of document? True alongside a
   * "rejected" status means the paperwork is correct but names another holder
   * — recoverable by proving a family relationship where the service allows
   * it. Always false when the status is "unverified": nothing was established.
   */
  typeMatches: boolean;
  documentType: string;
  holderName: string | null;
  /** Residential address read off the document, when extraction was asked for. */
  address: string | null;
  /** One short sentence suitable for the kiosk screen. */
  summary: string;
};

/** A verdict that could not be reached, carrying why for the kiosk screen. */
export const unverifiedAnalysis = (summary: string): DocumentAnalysis => ({
  status: "unverified",
  typeMatches: false,
  documentType: "Unknown",
  holderName: null,
  address: null,
  summary,
});

/**
 * Whether a document nobody could check may still satisfy a requirement.
 * True by default — the kiosk hands out real entitlements, so an unchecked
 * document has to stop the flow rather than pass through it. Set
 * `documents.require_verification: false` in config.yaml only to demo the
 * kiosk on a machine with no OCR or model attached, and understand that it
 * accepts every document unread.
 */
export const requireDocumentVerification = () =>
  (process.env.KIOSK_REQUIRE_DOCUMENT_VERIFICATION ?? "true") !== "false";

export const llmEnabled = () => MOCK_LLM || Boolean(BASE_URL);

/** Connection settings for callers that talk to the LLM through their own
 *  client (e.g. the chat route's Vercel AI SDK provider). `mock` means no
 *  real server should be contacted. */
export const llmConfig = () => ({
  mock: MOCK_LLM || !BASE_URL,
  baseUrl: BASE_URL ?? "",
  model: MODEL,
  apiKey: API_KEY,
  extraBody: EXTRA_BODY,
  maxTokens: MAX_TOKENS,
});

/**
 * What the LLM is asked to verify about an upload. Each use case is a
 * distinct task with its own system prompt (see prompts.ts, where all three
 * can be replaced from config.yaml) and instruction block — a shared
 * prompt with conditionals confuses small local models (e.g. the strictness
 * rules for a holder check directly contradict a relationship check, where a
 * certificate carrying several people's details is the whole point).
 *
 * - "document": the upload must be the required paperwork and every personal
 *   detail printed on it must belong to the expected holder.
 * - "address-proof": like "document", but the address printed on it is the
 *   NEW home being registered — it is extracted, never compared.
 * - "relationship-proof": the upload must be a birth certificate naming both
 *   the applicant and the related person (child + parent fields).
 */
export type AnalysisTask =
  | { kind: "document"; expectedName?: string; expectedNationalId?: string }
  | { kind: "address-proof"; expectedName?: string; expectedNationalId?: string }
  | { kind: "relationship-proof"; expectedName?: string; relatedName: string };

/** `wantsAddress`: only a proof of address is asked for the address printed
 *  on the document. Everywhere else the key is left out of the answer
 *  altogether — a model asked for an address a document does not print tends
 *  to supply one from its prompt rather than leave it null, and then rule on
 *  what it just made up. */
type TaskPrompt = { context: string[]; checks: string[]; matchesRule: string; wantsAddress: boolean };

/** Per-task user-prompt fragments: context lines, checks, and the matches rule. */
function taskPrompt(
  task: AnalysisTask,
  requirementLabel: string,
  accepts?: string[],
  holderRole?: string,
): TaskPrompt {
  const typeCheck = accepts?.length
    ? "1. Document type — this step accepts any ONE of these documents: " +
      `${accepts.join("; ")}. Report typeMatches as true if the scan is any one of them, ` +
      "and false only if it is none of them. The citizen is not expected to hold all of them."
    : `1. Document type — the scan really is the required document (${requirementLabel}), ` +
      "not a different kind of paperwork. Report this as typeMatches.";
  const holderCheck = (details: string[]) => {
    if (!details.length) return "2. Holder identity — note whose document this appears to be.";
    const whose = holderRole
      ? `This document names more than one person; the applicant is ${holderRole}. ` +
        `Compare the ${details.join(" and ")} printed for that person only — details ` +
        "belonging to anyone else named on the document are not a conflict. "
      : `Compare every personal detail printed on the document (${details.join(", ")}) ` +
        "against the expected holder above. Any printed detail that belongs to a " +
        "different person is a conflict. ";
    return (
      `2. Holder identity — ${whose}A detail the document simply does not show is not a ` +
      "conflict. Ignore trivial OCR noise, formatting and letter-case differences."
    );
  };
  const holderMatchesRule =
    "true only if typeMatches AND no printed detail conflicts with the expected holder";

  switch (task.kind) {
    case "document":
      return {
        context: [
          task.expectedName ? `Expected document holder: ${task.expectedName}` : "",
          task.expectedNationalId ? `Expected national ID number: ${task.expectedNationalId}` : "",
        ],
        checks: [
          typeCheck,
          holderCheck(
            [
              task.expectedName ? "name" : "",
              task.expectedNationalId ? "national ID number" : "",
            ].filter(Boolean),
          ),
        ],
        matchesRule: holderMatchesRule,
        wantsAddress: false,
      };
    case "address-proof":
      return {
        context: [
          task.expectedName ? `Expected document holder: ${task.expectedName}` : "",
          task.expectedNationalId ? `Expected national ID number: ${task.expectedNationalId}` : "",
        ],
        checks: [
          typeCheck,
          holderCheck(
            [
              task.expectedName ? "name" : "",
              task.expectedNationalId ? "national ID number" : "",
            ].filter(Boolean),
          ),
          "3. Address — copy the residential address printed on the document into the " +
            '"address" key. The applicant is registering this address as their new home, so ' +
            "it is expected to differ from any address on record — a different address is " +
            "never a conflict for this document.",
        ],
        matchesRule: holderMatchesRule,
        wantsAddress: true,
      };
    case "relationship-proof": {
      const applicant = task.expectedName ?? "the applicant";
      return {
        context: [`Applicant: ${applicant}`, `Family member to link: ${task.relatedName}`],
        checks: [
          typeCheck,
          `2. Names — check two things independently: (a) is the name "${applicant}" printed ` +
            `anywhere on the certificate? (b) is the name "${task.relatedName}" printed ` +
            "anywhere on the certificate? Both must be present. They will be in different " +
            "fields (child, father, or mother) — that is expected; do NOT require them to " +
            "appear together or in any particular field. Ignore trivial OCR noise, " +
            "formatting and letter-case differences.",
        ],
        matchesRule: "true only if typeMatches AND both names above are printed on the certificate",
        wantsAddress: false,
      };
    }
  }
}

/** Reachability of the model server. See ./health for what the codes mean. */
export function llmHealth(): Promise<ServiceHealth> {
  // A simulated verdict needs no server, so there is nothing to probe.
  if (MOCK_LLM) return Promise.resolve("ok");
  return probeService({
    baseUrl: BASE_URL,
    path: HEALTH_PATH,
    enabled: healthCheckEnabled("KIOSK_LLM_HEALTH_CHECK"),
    ...(API_KEY ? { headers: { authorization: `Bearer ${API_KEY}` } } : {}),
  });
}

export async function analyzeDocument(args: {
  serviceLabel: string;
  requirementLabel: string;
  requirementHint: string;
  /** The alternatives that satisfy the requirement, if it has more than one. */
  accepts?: string[];
  /** Who the applicant is on a document that names several people. */
  holderRole?: string;
  task: AnalysisTask;
  text: string;
}): Promise<DocumentAnalysis> {
  if (MOCK_LLM) return mockAnalysis(args);
  if (!BASE_URL) {
    return unverifiedAnalysis("Document checking is not configured on this kiosk.");
  }

  const { context, checks, matchesRule, wantsAddress } = taskPrompt(
    args.task,
    args.requirementLabel,
    args.accepts,
    args.holderRole,
  );

  const prompt = [
    `Service: ${args.serviceLabel}`,
    `Required document: ${args.requirementLabel} (${args.requirementHint})`,
    ...context,
    "",
    "Scanned document text (from OCR; small recognition errors are normal):",
    '"""',
    args.text.slice(0, MAX_TEXT_CHARS),
    '"""',
    "",
    "Verify the following, strictly:",
    ...checks,
    "",
    "Return a JSON object with exactly these keys:",
    '{"documentType": "<what kind of document this is>",',
    ' "holderName": "<full name printed on the document itself, or null>",',
    ' "typeMatches": <true only if the scan is the required kind of document>,',
    ...(wantsAddress
      ? [
          ' "address": <the residential address printed in the scanned text above, copied' +
            " verbatim, or null if it prints none>,",
        ]
      : []),
    ` "matches": <${matchesRule}>,`,
    ' "summary": "<one short sentence for the kiosk screen; when matches is false, state exactly what is wrong>"}',
  ]
    .filter((line) => line !== "")
    .join("\n");

  const content = await completeText(systemPrompt(args.task.kind), prompt);
  if (content === null) {
    return unverifiedAnalysis("The document check did not complete — the AI service did not answer.");
  }
  return (
    parseAnalysis(content) ??
    unverifiedAnalysis("The document check did not complete — the AI service gave an unusable answer.")
  );
}

/* ── What the capture actually holds ───────────────────────────────── */

/** A run of sheets that are one document, and what kind it looks like. */
export type CapturedDocument = { pages: number[]; documentType: string };

/**
 * Per-page text budget for the triage prompt. Small because the question is
 * only "what IS this sheet" — the letterhead, the title and the first few
 * lines answer it, and sending whole pages for every sheet is what pushes a
 * local model past its context on a stack of paper.
 */
const MAX_PAGE_CHARS = 1_200;

/**
 * How many separate documents the sheets of one capture turned out to be.
 *
 * A capture is one PDF, but a scanner feeder does not know that: someone who
 * puts their utility bill and their MyKad in together gets both as pages of
 * one file, and the verification prompt then reads a single blob in which the
 * required document's text IS present — so it answers yes, and the second
 * document is filed as extra pages of the first, never checked against
 * anything. Asking where one document ends and the next begins is a different
 * question from whether the paperwork is right, so it is asked separately.
 *
 * Returns null when the question could not be answered — the model is off,
 * mocked without enough to go on, unreachable, or gave an answer that is not
 * a clean partition of the pages. Null never blocks a citizen: a capture
 * whose grouping is unknown still goes through the ordinary verification
 * below, which has its own policy for a model that would not answer.
 */
export async function groupCapturedDocuments(
  pages: string[],
): Promise<CapturedDocument[] | null> {
  // One sheet cannot be two documents, and the common case is one sheet — so
  // the usual capture costs nothing at all.
  if (pages.length < 2) return null;
  if (MOCK_LLM) return mockGrouping(pages);
  if (!BASE_URL) return null;

  const prompt = [
    `A citizen fed ${pages.length} sheets into the kiosk scanner in one go. The OCR text of`,
    "each sheet follows, in the order they were fed.",
    "",
    ...pages.flatMap((page, index) => [
      `--- Sheet ${index + 1} ---`,
      page.slice(0, MAX_PAGE_CHARS),
      "",
    ]),
    "Group the sheets into the documents they belong to. Sheets that continue the same",
    "document stay in one group; a sheet that is plainly different paperwork starts a new",
    "one. Every sheet must appear in exactly one group, and groups must be in feed order.",
    "",
    "Return a JSON object with exactly this shape:",
    '{"documents": [{"pages": [1, 2], "documentType": "<what kind of document this is>"}]}',
  ].join("\n");

  const content = await completeText(systemPrompt("group-capture"), prompt);
  return content === null ? null : parseGrouping(content, pages.length);
}

/**
 * The model's grouping, accepted only if it is a clean partition of the
 * sheets that were sent: every page present exactly once, in feed order.
 *
 * Deliberately strict, and it fails towards null rather than towards a split.
 * A model that drops a page or invents sheet 7 of a 3-page scan has not
 * understood the question, and acting on that answer would refuse a genuine
 * two-page bill for being two documents — a far worse outcome than missing a
 * mixed capture, which the verification check still has a chance at.
 */
function parseGrouping(content: string, pageCount: number): CapturedDocument[] | null {
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, "");
  const candidates = jsonObjects(cleaned).filter((c) => c.includes('"documents"'));
  for (const candidate of candidates.reverse()) {
    let parsed: { documents?: unknown };
    try {
      parsed = JSON.parse(candidate) as { documents?: unknown };
    } catch {
      continue;
    }
    if (!Array.isArray(parsed.documents) || parsed.documents.length === 0) continue;
    const groups: CapturedDocument[] = [];
    const seen: number[] = [];
    for (const raw of parsed.documents) {
      const group = raw as { pages?: unknown; documentType?: unknown };
      if (!Array.isArray(group.pages) || group.pages.length === 0) return null;
      const numbers = group.pages.map(Number);
      if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > pageCount)) return null;
      seen.push(...numbers);
      groups.push({
        pages: numbers,
        documentType: String(group.documentType ?? "Document"),
      });
    }
    const partitions =
      seen.length === pageCount && seen.every((page, index) => page === index + 1);
    return partitions ? groups : null;
  }
  return null;
}

/**
 * The simulated grouping, so a kiosk running on KIOSK_LLM_MOCK can still
 * demonstrate a mixed capture being refused. Sheets are grouped by their
 * first meaningful line, which is the letterhead on every mock document the
 * kit ships — enough to tell two different papers apart, and nothing like
 * good enough to be a real check.
 */
function mockGrouping(pages: string[]): CapturedDocument[] {
  const heading = (page: string) =>
    page.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  const groups: CapturedDocument[] = [];
  pages.forEach((page, index) => {
    const title = heading(page);
    const last = groups[groups.length - 1];
    if (last && last.documentType === title) last.pages.push(index + 1);
    else groups.push({ pages: [index + 1], documentType: title || "Document" });
  });
  return groups;
}

/**
 * One-shot completion against the configured OpenAI-compatible server, for
 * the small single-task prompts this kiosk uses (document verdicts, chat
 * intent routing). Returns the raw assistant text, or null when the LLM is
 * mocked, unconfigured, or unreachable — callers must degrade gracefully.
 */
export async function completeText(system: string, user: string): Promise<string | null> {
  if (MOCK_LLM || !BASE_URL) return null;
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: MAX_TOKENS,
        ...EXTRA_BODY,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return body.choices?.[0]?.message?.content ?? null;
  } catch {
    // The kiosk must keep working when the LLM is down.
    return null;
  }
}

/**
 * Simulated verdict built from the OCR text: document type from the first
 * meaningful line, holder confirmed only if the verified citizen's name
 * actually appears in the scan. The mock documents all carry the same
 * fictional holder, so the mock accepts by default rather than comparing
 * names — force KIOSK_LLM_MOCK_VERDICT=mismatch to exercise the
 * wrong-holder path (relationship proofs still accept, so the recovery flow
 * can be walked end to end).
 */
function mockAnalysis(args: {
  requirementLabel: string;
  task: AnalysisTask;
  text: string;
}): DocumentAnalysis {
  const { task } = args;
  const lines = args.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const documentType = lines[0] ?? args.requirementLabel;
  // Malaysian addresses end in a 5-digit postcode — good enough for the mock.
  const address =
    task.kind === "address-proof" ? (lines.find((line) => /\b\d{5}\b/.test(line)) ?? null) : null;
  const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z ]/g, " ").replace(/ +/g, " ");
  const hasName = (name?: string) =>
    Boolean(name && normalize(args.text).includes(normalize(name)));
  const holderName = hasName(task.expectedName) ? (task.expectedName ?? null) : null;

  if (task.kind === "relationship-proof") {
    return {
      status: "accepted",
      typeMatches: true,
      documentType,
      holderName,
      address,
      summary: `Simulated check — proof of relationship to ${task.relatedName} accepted.`,
    };
  }

  if (MOCK_VERDICT === "mismatch") {
    return {
      status: "rejected",
      typeMatches: true,
      documentType,
      holderName: null,
      address,
      summary: `Simulated check — document does not appear to belong to ${
        task.expectedName ?? "the applicant"
      }.`,
    };
  }

  return {
    status: "accepted",
    typeMatches: true,
    documentType,
    holderName,
    address,
    summary: `Simulated check — ${documentType} accepted.`,
  };
}

/**
 * Small and reasoning models wrap the JSON in prose, code fences, or a
 * thinking preamble that may itself contain braces — extract every balanced
 * object and take the last one that carries the expected keys.
 */
function parseAnalysis(content: string): DocumentAnalysis | null {
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, "");
  const candidates = jsonObjects(cleaned).filter((c) => c.includes('"matches"'));
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const matches = parsed.matches === true;
      return {
        // The model was reached and answered, so this is a real verdict:
        // anything short of an explicit `true` is a rejection, never an
        // "unverified" — that state is reserved for a check that never ran.
        status: matches ? "accepted" : "rejected",
        // Older/smaller models may omit the key — fall back to the verdict.
        typeMatches: "typeMatches" in parsed ? parsed.typeMatches === true : matches,
        documentType: String(parsed.documentType ?? "Document"),
        holderName: typeof parsed.holderName === "string" ? parsed.holderName : null,
        address: typeof parsed.address === "string" && parsed.address ? parsed.address : null,
        summary: String(parsed.summary ?? ""),
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** Every balanced, string-aware `{...}` substring of the content. */
function jsonObjects(content: string): string[] {
  const objects: string[] = [];
  for (let i = content.indexOf("{"); i !== -1; i = content.indexOf("{", i + 1)) {
    let depth = 0;
    let inString = false;
    for (let j = i; j < content.length; j++) {
      const ch = content[j];
      if (inString) {
        if (ch === "\\") j++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}" && --depth === 0) {
        objects.push(content.slice(i, j + 1));
        break;
      }
    }
  }
  return objects;
}
