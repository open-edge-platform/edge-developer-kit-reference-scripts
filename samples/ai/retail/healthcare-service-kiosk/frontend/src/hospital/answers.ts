// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { resultData, type ServiceResult } from "@/services/shared/result";
import { EMERGENCY_NOTICE, HEALTH_DISCLAIMER } from "./data";
import {
  covers,
  exactChunk,
  HEALTH_GUIDE,
  healthPassages,
  HOSPITAL_GUIDE,
  hospitalPassages,
  type KnowledgeChunk,
} from "./knowledge";
import type { Hit } from "./retrieval";
import { asksPersonalAdvice, redFlag, type RedFlag } from "./safety";

/**
 * What a question service shows. The deterministic answers here are complete on their own; the server may replace an
 * "answer" with a model's rewording of the same passages (`aiAssisted`), never with anything else.
 */
export type GroundedAnswer = {
  kind: "answer" | "unknown" | "emergency" | "refusal";
  question: string;
  title: string;
  text: string;
  sources: { id: string; title: string; source: string }[];
  aiAssisted: boolean;
  /** Directions-service destination id for "Show me the way". */
  destination?: string;
  /** The closest passage, shown when the guide has something near the question but not its answer. */
  related?: { title: string; text: string };
  note?: string;
};

export const INFORMATION_COUNTER = "Please ask at the Information Counter in the main lobby, Block A Level 2.";

const CRISIS_LINES = "You can also call Befrienders KL at 03-7627 2929 (24 hours) or Talian HEAL 15555.";

export const cite = (chunk: KnowledgeChunk) => ({ id: chunk.id, title: chunk.title, source: chunk.source });

export function passageAnswer(question: string, chunk: KnowledgeChunk, note?: string): GroundedAnswer {
  return {
    kind: "answer",
    question,
    title: chunk.title,
    text: chunk.text,
    sources: [cite(chunk)],
    aiAssisted: false,
    destination: chunk.destination,
    note,
  };
}

export function hospitalUnknown(question: string, related?: KnowledgeChunk): GroundedAnswer {
  return {
    kind: "unknown",
    question,
    title: "Ask at the Information Counter",
    text: `I couldn't find that in the hospital guide. ${INFORMATION_COUNTER}`,
    sources: [],
    aiAssisted: false,
    related: related && { title: related.title, text: related.text },
  };
}

export function healthUnknown(question: string, related?: KnowledgeChunk): GroundedAnswer {
  return {
    kind: "unknown",
    question,
    title: "Please ask a nurse or pharmacist",
    text: "I can only answer general questions from the hospital's patient guides. Please ask a nurse or pharmacist.",
    sources: [],
    aiAssisted: false,
    related: related && { title: related.title, text: related.text },
    note: HEALTH_DISCLAIMER,
  };
}

export function emergencyAnswer(question: string, flag: RedFlag, note?: string): GroundedAnswer {
  return {
    kind: "emergency",
    question,
    title: "Please seek care now",
    text: flag.crisis ? `${EMERGENCY_NOTICE} ${CRISIS_LINES}` : EMERGENCY_NOTICE,
    sources: [],
    aiAssisted: false,
    destination: "emergency",
    note,
  };
}

export function refusalAnswer(question: string): GroundedAnswer {
  return {
    kind: "refusal",
    question,
    title: "Please ask a doctor or pharmacist",
    text:
      "I can't advise on your own medicines, doses or diagnosis. Please ask your doctor, or a pharmacist at the " +
      "Pharmacy in Block A Level 1 — and don't stop or change a medicine before talking to them.",
    sources: [],
    aiAssisted: false,
    destination: "pharmacy",
    note: HEALTH_DISCLAIMER,
  };
}

/** Answers no model may touch: an emergency, or a tapped topic / department, which is quoted as written. */
export function hospitalFixed(query: string): GroundedAnswer | null {
  const flag = redFlag(query);
  if (flag) return emergencyAnswer(query, flag);
  const chunk = exactChunk(HOSPITAL_GUIDE, query);
  return chunk ? passageAnswer(chunk.title, chunk) : null;
}

/** Red flags first, then personal medical advice, then a tapped topic. */
export function healthFixed(question: string): GroundedAnswer | null {
  const flag = redFlag(question);
  if (flag) return emergencyAnswer(question, flag, HEALTH_DISCLAIMER);
  if (asksPersonalAdvice(question)) return refusalAnswer(question);
  const chunk = exactChunk(HEALTH_GUIDE, question);
  return chunk ? passageAnswer(chunk.title, chunk, HEALTH_DISCLAIMER) : null;
}

/** The best passage quoted as written; one that only touches the question is offered as related, not as its answer. */
export function quotedHospitalAnswer(question: string, top: Hit<KnowledgeChunk>): GroundedAnswer {
  return covers(top, question) ? passageAnswer(question, top.doc) : hospitalUnknown(question, top.doc);
}

export function quotedHealthAnswer(question: string, top: Hit<KnowledgeChunk>): GroundedAnswer {
  return covers(top, question) ? passageAnswer(question, top.doc, HEALTH_DISCLAIMER) : healthUnknown(question, top.doc);
}

/** The whole answer without a model. */
export function hospitalAnswerOffline(query: string): GroundedAnswer {
  const fixed = hospitalFixed(query);
  if (fixed) return fixed;
  const [top] = hospitalPassages(query);
  return top ? quotedHospitalAnswer(query, top) : hospitalUnknown(query);
}

export function healthAnswerOffline(question: string): GroundedAnswer {
  const fixed = healthFixed(question);
  if (fixed) return fixed;
  const [top] = healthPassages(question);
  return top ? quotedHealthAnswer(question, top) : healthUnknown(question);
}

export function answerResult(answer: GroundedAnswer): ServiceResult {
  const rows = [{ label: answer.kind === "answer" ? "Answer" : "What to do", value: answer.text }];
  if (answer.sources.length) {
    rows.push({ label: "Source", value: answer.sources.map((s) => `${s.title} (${s.source})`).join("; ") });
  }
  if (answer.related) rows.push({ label: answer.related.title, value: answer.related.text });
  const ai = answer.aiAssisted ? "AI-assisted answer, written only from the hospital guide." : "";
  return { title: answer.title, rows, note: [ai, answer.note].filter(Boolean).join(" ") || undefined };
}

/** Flow data for the touch result step: the answer itself plus the shared result fields. */
export function answerData(answer: GroundedAnswer): Record<string, string> {
  return { answer: JSON.stringify(answer), ...resultData(answerResult(answer)) };
}

export function readAnswer(data: Record<string, string>): GroundedAnswer | null {
  try {
    const answer = JSON.parse(data.answer ?? "") as GroundedAnswer;
    return typeof answer?.text === "string" && Array.isArray(answer.sources) ? answer : null;
  } catch {
    return null;
  }
}
