// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import {
  cite,
  healthFixed,
  healthUnknown,
  hospitalFixed,
  hospitalUnknown,
  quotedHealthAnswer,
  quotedHospitalAnswer,
  type GroundedAnswer,
} from "@/hospital/answers";
import { HEALTH_DISCLAIMER } from "@/hospital/data";
import { healthPassages, hospitalPassages, type KnowledgeChunk } from "@/hospital/knowledge";
import type { Hit } from "@/hospital/retrieval";
import { completeJson, onlyKnownNumbers, quoted, withinDeadline, wordCount } from "./llm-json";

const MAX_QUESTION_CHARS = 300;

const HEALTH_UNSAFE: RegExp[] = [
  /diagnos/i,
  /(?<!\b(?:if|when|unless|whether|in case|once) )\byou (?:definitely |probably |likely |may |might |could )?(?:have|are suffering)\b/i,
  /nothing to worry|no need to worry|don'?t worry|not serious|nothing serious/i,
  /\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml|units?|tablets?|pills?|capsules?)\b/i,
  /https?:\/\//i,
];

const AnswerSchema = z.object({
  answer: z.string(),
  citations: z.array(z.string()),
  answerable: z.boolean(),
});

type Guide = {
  system: string;
  unknown: (question: string, related?: KnowledgeChunk) => GroundedAnswer;
  quoted: (question: string, top: Hit<KnowledgeChunk>) => GroundedAnswer;
  unsafe: RegExp[];
  note?: string;
};

const HOSPITAL: Guide = {
  system:
    "You are the information assistant on a hospital kiosk. Answer the visitor's question using ONLY the passages " +
    "given. Never add facts, times, prices, places or advice that are not in the passages. Reply with one JSON " +
    "object and nothing else.",
  unknown: hospitalUnknown,
  quoted: quotedHospitalAnswer,
  unsafe: [/https?:\/\//i],
};

const HEALTH: Guide = {
  system:
    "You answer general health questions on a hospital kiosk using ONLY the passages given from the hospital's " +
    "patient health guide. Never diagnose, never tell the person what illness they have, never give doses or tell " +
    "anyone to start, stop or change a medicine, and never say there is nothing to worry about. Reply with one JSON " +
    "object and nothing else.",
  unknown: healthUnknown,
  quoted: quotedHealthAnswer,
  unsafe: HEALTH_UNSAFE,
  note: HEALTH_DISCLAIMER,
};

function answerPrompt(question: string, passages: KnowledgeChunk[]): string {
  return [
    "Passages:",
    ...passages.map((p) => `[${p.id}] ${p.title}: ${p.text}`),
    "",
    `Question: "${quoted(question)}"`,
    "",
    'Write "answer" in 1 to 3 short, plain sentences (under 60 words), in the language of the question.',
    "Copy times, prices, phone numbers and other numbers exactly as the passages write them.",
    'Put the ids of the passages you used in "citations".',
    'If the passages do not answer the question, set "answerable" to false and "answer" to "".',
    'Return exactly: {"answer": "...", "citations": ["<id>"], "answerable": true}',
  ].join("\n");
}

/**
 * The model rewords the top passages into an answer, and is believed only when it cites passages it was given,
 * repeats no number they lack and stays short and inside the guide's safety lines. Anything else — including a
 * mocked, slow or absent model — falls back to the best passage, quoted as written.
 */
async function groundedAnswer(question: string, hits: Hit<KnowledgeChunk>[], guide: Guide): Promise<GroundedAnswer> {
  const passages = hits.map((h) => h.doc);
  const fallback = guide.quoted(question, hits[0]);
  const reply = await withinDeadline(completeJson(guide.system, answerPrompt(question, passages), AnswerSchema));
  if (!reply) return fallback;
  if (!reply.answerable) return guide.unknown(question, passages[0]);

  const cited = passages.filter((p) => reply.citations.includes(p.id));
  const answer = reply.answer.trim();
  const source = cited.map((p) => `${p.title} ${p.text}`).join(" ");
  const trusted =
    cited.length > 0 &&
    reply.citations.every((id) => passages.some((p) => p.id === id)) &&
    answer.length > 0 &&
    wordCount(answer) <= 80 &&
    onlyKnownNumbers(answer, source) &&
    !guide.unsafe.some((pattern) => pattern.test(answer));
  if (!trusted) return fallback;

  return {
    kind: "answer",
    question,
    title: cited[0].title,
    text: answer,
    sources: cited.map(cite),
    aiAssisted: true,
    destination: cited[0].destination,
    note: guide.note,
  };
}

/** Hospital information: a tapped topic is quoted; free text is retrieved, and below the bar never reaches the model. */
export async function hospitalAnswer(query: string): Promise<GroundedAnswer> {
  const question = query.trim().slice(0, MAX_QUESTION_CHARS);
  const fixed = hospitalFixed(question);
  if (fixed) return fixed;
  const hits = hospitalPassages(question);
  if (hits.length === 0) return hospitalUnknown(question);
  return groundedAnswer(question, hits, HOSPITAL);
}

/** General health Q&A: red flags, then the personal-advice guard, then retrieval — the model only rewords the guide. */
export async function healthAnswer(query: string): Promise<GroundedAnswer> {
  const question = query.trim().slice(0, MAX_QUESTION_CHARS);
  const fixed = healthFixed(question);
  if (fixed) return fixed;
  const hits = healthPassages(question);
  if (hits.length === 0) return healthUnknown(question);
  return groundedAnswer(question, hits, HEALTH);
}
