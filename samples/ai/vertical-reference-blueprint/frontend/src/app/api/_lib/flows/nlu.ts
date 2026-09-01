// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { SERVICES } from "@/services";
import { matchOptionAnswers } from "@/lib/ask-match";
import { fold } from "@/lib/text";
import { activePack } from "@/packs";
import { completeText } from "../llm";
import { systemPrompt } from "../prompts";
import { REQUESTS_FLOW_ID } from "./types";
import type { Ask } from "./types";

// The synonym tables, phonetic-error hint and routing examples are the
// country pack's — see src/packs/<pack>/nlu.ts.
const SERVICE_KEYWORDS = () => activePack().nlu.serviceKeywords;
const REQUESTS_KEYWORDS = () => activePack().nlu.requestsKeywords;

// Explicit "none of these" choice — small local models pick reliably from a
// list containing one, but are unreliable at returning null on demand.
const NO_SERVICE = "none";

const norm = fold;

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

function keywordService(text: string): string | null {
  const message = norm(text);
  let best: { id: string; score: number } | null = null;
  for (const service of SERVICES) {
    const keywords = [
      ...(SERVICE_KEYWORDS()[service.id] ?? []),
      norm(service.label),
    ];
    const score = keywords.reduce(
      (sum, keyword) => (message.includes(keyword) ? sum + keyword.length : sum),
      0,
    );
    if (score > 0 && (!best || score > best.score)) best = { id: service.id, score };
  }
  return best?.id ?? null;
}

/** Which kiosk service (if any) a free-text request is asking for — or
 *  REQUESTS_FLOW_ID for questions about an existing application. Keywords
 *  match deterministically; the LLM only sees fuzzy phrasing. */
export async function classifyService(text: string): Promise<string | null> {
  // Existing-application phrasing wins over service words.
  const message = norm(text);
  if (REQUESTS_KEYWORDS().some((keyword) => message.includes(keyword))) return REQUESTS_FLOW_ID;

  const byKeyword = keywordService(text);
  if (byKeyword) return byKeyword;

  const listing = [
    ...SERVICES.map((s) => `- ${s.id}: ${s.label} — ${s.description}`),
    `- ${REQUESTS_FLOW_ID}: My Requests — the status of an application already saved or ` +
      "submitted, or resuming a saved one",
    `- ${NO_SERVICE}: the message does not ask to start any service above — a greeting, a ` +
      "question about the kiosk or its fees, small talk, or speech the recogniser garbled",
  ].join("\n");
  const { phoneticHint, routeExamples } = activePack().nlu;
  const reply = await completeText(
    systemPrompt("route-service"),
    `Available options:\n${listing}\n\n` +
      `${phoneticHint}\n\n` +
      "Examples:\n" +
      `- "hello" -> {"serviceId": "${NO_SERVICE}"}\n` +
      `- "what services do you have?" -> {"serviceId": "${NO_SERVICE}"}\n` +
      `- "how much does it cost?" -> {"serviceId": "${NO_SERVICE}"}\n` +
      routeExamples +
      `Citizen's message: "${text}"\n\n` +
      'Return {"serviceId": "<one id from the list above>"}. Choose ' +
      `"${NO_SERVICE}" unless the message really is asking to start one of the services — ` +
      "guessing drags the citizen into a long application they never asked for.",
  );
  const parsed = parseJson<{ serviceId?: string | null }>(reply);
  const picked = parsed?.serviceId;
  if (picked && (picked === REQUESTS_FLOW_ID || SERVICES.some((s) => s.id === picked))) {
    return picked;
  }
  return null;
}

function keywordAnswers(text: string, asks: Ask[]): Record<string, string> {
  // Same option matcher the chat UI uses — keep the surfaces agreeing.
  const answers = matchOptionAnswers(text, asks);
  // A lone unanswered text ask takes the whole message verbatim.
  const textAsks = asks.filter((a) => a.type === "text" && !answers[a.id]);
  if (textAsks.length === 1 && Object.keys(answers).length === 0 && text.trim()) {
    answers[textAsks[0].id] = text.trim();
  }
  return answers;
}

/** Map a free-text reply onto the pending asks; options answers are
 *  validated against the allowed values. */
export async function extractAnswers(text: string, asks: Ask[]): Promise<Record<string, string>> {
  const relevant = asks.filter((a) => a.type !== "document");
  if (relevant.length === 0) return {};

  const listing = relevant
    .map((ask) => {
      const options = ask.options
        ?.map((option) => `    - "${option.value}" (${option.label})`)
        .join("\n");
      return `- id "${ask.id}": ${ask.question}${options ? `\n  Allowed values:\n${options}` : "\n  (free text)"}`;
    })
    .join("\n");

  const reply = await completeText(
    systemPrompt("extract-answers"),
    `Questions:\n${listing}\n\nCitizen's message: "${text}"\n\n` +
      "Return a JSON object mapping question ids to answers, including ONLY the questions " +
      "this message clearly answers. Where allowed values are listed, the answer MUST be " +
      "one of those values.",
  );
  const parsed = parseJson<Record<string, unknown>>(reply);
  if (parsed !== null) {
    const answers: Record<string, string> = {};
    for (const ask of relevant) {
      const value = parsed[ask.id];
      if (typeof value !== "string" && typeof value !== "number") continue;
      const text = String(value).trim();
      if (!text) continue;
      if (ask.options && !ask.options.some((o) => o.value === text)) continue;
      answers[ask.id] = text;
    }
    return answers;
  }
  return keywordAnswers(text, asks);
}
