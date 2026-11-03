// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { DEPARTMENTS, HEALTH_ANSWERS, HOSPITAL_TOPICS, SPECIALIST_DEPARTMENTS } from "./data";
import { bm25Index, searchTerms, type Hit } from "./retrieval";

/** One passage of a curated guide: what retrieval ranks, what the model may quote, what the screen cites. */
export type KnowledgeChunk = {
  id: string;
  title: string;
  text: string;
  source: string;
  keywords: string[];
  /** Directions-service destination id, when the answer is a place the visitor can be walked to. */
  destination?: string;
};

const TOPIC_DESTINATIONS: Record<string, string> = {
  vaccination: "paediatrics",
  emergency: "emergency",
  payment: "billing",
  "pharmacy-hours": "pharmacy",
  cafeteria: "cafeteria",
  surau: "surau",
  atm: "atm",
  restrooms: "restroom",
};

/** The words people use for a department rather than its name. */
const DEPARTMENT_WORDS: Record<string, string[]> = {
  cardiology: ["cardiologist", "heart"],
  orthopaedics: ["orthopaedic", "orthopedic", "bone", "bones", "joint", "knee", "back pain"],
  paediatrics: ["paediatrician", "pediatrician", "child", "children", "kids", "baby"],
  obgyn: ["gynaecologist", "gynecologist", "obstetrician", "pregnancy", "pregnant", "antenatal"],
  dermatology: ["dermatologist", "skin", "rash", "eczema"],
  radiology: ["x-ray", "xray", "scan", "mri", "ct", "ultrasound"],
  laboratory: ["lab", "blood test", "test results"],
  pharmacy: ["medicine", "medication", "prescription", "refill"],
  emergency: ["a&e", "accident", "urgent"],
  registration: ["register", "registering", "admission", "admissions", "new patient", "patient card"],
  billing: ["bill", "pay", "insurance", "guarantee letter", "invoice"],
};

const named = (ids: string[]) => DEPARTMENTS.filter((d) => ids.includes(d.id)).map((d) => d.name).join(", ");

/** "What services are available?" — the whole hospital in one passage, so the question the spreadsheet asks has an answer. */
const OVERVIEW: KnowledgeChunk = {
  id: "topic:services",
  title: "What services are available at this hospital?",
  text:
    `Specialist clinics: ${named(SPECIALIST_DEPARTMENTS)} — by appointment, with a referral letter for a first visit. ` +
    `Also: ${DEPARTMENTS.filter((d) => !SPECIALIST_DEPARTMENTS.includes(d.id)).map((d) => `${d.name} (${d.hours})`).join(", ")}. ` +
    "At this kiosk you can register as a new patient, check in for today's appointment, book a specialist or follow-up visit, " +
    "see your prescriptions and lab results, request a refill, check lab test and procedure prices, check your insurance, " +
    "pay your bill, validate a referral letter, upload medical records, find a doctor, get directions and give feedback.",
  source: "Patient & visitor guide",
  keywords: ["services", "service", "available", "offer", "offered", "provide", "departments", "clinics", "specialists", "what can", "facilities"],
};

export const HOSPITAL_GUIDE: KnowledgeChunk[] = [
  OVERVIEW,
  ...HOSPITAL_TOPICS.map((t) => ({
    id: `topic:${t.id}`,
    title: t.question,
    text: t.answer,
    source: "Patient & visitor guide",
    keywords: t.keywords,
    destination: TOPIC_DESTINATIONS[t.id],
  })),
  ...DEPARTMENTS.map((d) => ({
    id: `dept:${d.id}`,
    title: d.name,
    text: `${d.name} is in ${d.building}, ${d.floor}. Open ${d.hours}. Services: ${d.services}. ${d.requirements}`,
    source: "Department directory",
    keywords: [d.id, d.name, d.services, ...(DEPARTMENT_WORDS[d.id] ?? [])],
    destination: d.id,
  })),
];

export const HEALTH_GUIDE: KnowledgeChunk[] = HEALTH_ANSWERS.map((t) => ({
  id: `health:${t.id}`,
  title: t.question,
  text: t.answer,
  source: "Patient health guide",
  keywords: t.keywords,
}));

/** Below this BM25 score a question is not about anything the guide covers, and nothing is answered from it. */
export const MIN_SCORE = 1.5;

/**
 * Ranks a guide's passages for a question, led by the best one that is confidently about it — scoring at least
 * MIN_SCORE on a word of its title or keywords, not just its body ("life" in "life-threatening"). None qualifies: [].
 */
function passageSearch(chunks: KnowledgeChunk[]) {
  const search = bm25Index(chunks, (c) => [c.title, c.title, c.keywords.join(" "), c.keywords.join(" "), c.text]);
  const heads = new Map(chunks.map((c) => [c.id, new Set(searchTerms(`${c.title} ${c.keywords.join(" ")}`))]));
  return (query: string): Hit<KnowledgeChunk>[] => {
    const hits = search(query, 3);
    const lead = hits.find((h) => h.score >= MIN_SCORE && h.matched.some((term) => heads.get(h.doc.id)!.has(term)));
    return lead ? [lead, ...hits.filter((h) => h !== lead)] : [];
  };
}

/** Whether the best passage speaks to at least half of the question, so quoting it can stand as the answer. */
export function covers(hit: Hit<KnowledgeChunk>, query: string): boolean {
  return hit.matched.length * 2 >= new Set(searchTerms(query)).size;
}

export const hospitalPassages = passageSearch(HOSPITAL_GUIDE);
export const healthPassages = passageSearch(HEALTH_GUIDE);

/** A tapped topic or department ("topic:parking", "dept:cardiology", or its bare id / exact name). */
export function exactChunk(chunks: KnowledgeChunk[], query: string): KnowledgeChunk | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return chunks.find(
    (c) => c.id === q || c.id.slice(c.id.indexOf(":") + 1) === q || c.title.toLowerCase() === q,
  );
}
