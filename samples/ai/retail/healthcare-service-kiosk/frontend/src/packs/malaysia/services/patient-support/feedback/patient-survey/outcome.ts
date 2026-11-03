// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceResult } from "@/services/shared/result";

const RATING_LABELS = ["", "Very poor", "Poor", "Average", "Good", "Excellent"];
export const RATING_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: RATING_LABELS[n] }));
export const AREA_OPTIONS = ["Registration", "Clinic", "Pharmacy", "Billing", "Facilities"];

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export const URGENCIES = ["low", "medium", "high", "critical"] as const;
export const CATEGORIES = [
  "wait",
  "staff",
  "cleanliness",
  "billing",
  "facilities",
  "parking",
  "clinical",
  "food",
  "wayfinding",
  "other",
] as const;

export type Sentiment = (typeof SENTIMENTS)[number];
export type Urgency = (typeof URGENCIES)[number];
export type Category = (typeof CATEGORIES)[number];

export type FeedbackTriage = {
  sentiment: Sentiment;
  categories: Category[];
  urgency: Urgency;
  safetyFlag: boolean;
  summary: string;
  classifiedBy: "llm" | "rules";
};

const CATEGORY_LABELS: Record<Category, string> = {
  wait: "Waiting time",
  staff: "Staff",
  cleanliness: "Cleanliness",
  billing: "Billing",
  facilities: "Facilities",
  parking: "Parking",
  clinical: "Care and treatment",
  food: "Food",
  wayfinding: "Finding your way",
  other: "General",
};

const CATEGORY_WORDS: Record<Exclude<Category, "other">, RegExp> = {
  wait: /\b(wait\w*|queue\w*|slow|delay\w*|took (so |too )?long|tunggu|menunggu|beratur|giliran|lambat|lama)\b/,
  staff: /\b(staff|nurses?|receptionists?|counter|attitude|rude|friendly|helpful|polite|jururawat|kakitangan|petugas|pekerja|sombong|biadab|kurang ajar|mesra|baik hati)\b/,
  cleanliness: /\b(dirty|clean\w*|smell\w*|stink\w*|toilets?|rubbish|cockroach\w*|kotor|bersih|busuk|bau|tandas|sampah|lipas)\b/,
  billing: /\b(bill\w*|charge\w*|payment|paid|price\w*|expensive|cost\w*|insurance|refund|deposit|bil|bayaran|mahal|caj|insurans)\b/,
  facilities: /\b(air ?con\w*|aircond|lifts?|elevators?|chairs?|seats?|wifi|broken|hot|cold|lighting|facilit\w*|kemudahan|rosak|panas|sejuk|kerusi)\b/,
  parking: /\b(parking|car ?park|parkir|letak kereta|kereta)\b/,
  clinical: /\b(doctors?|treatment|diagnos\w*|medicines?|medication|prescription|pain|surgery|injection|doktor|rawatan|ubat|sakit|pembedahan)\b/,
  food: /\b(food|meals?|cafeteria|canteen|cafe|drinks?|makanan|makan|kantin|minuman)\b/,
  wayfinding: /\b(lost|signs?|signage|directions?|find(ing)? (the|my) way|couldnt find|could not find|sesat|papan tanda|arah|tak jumpa)\b/,
};

const NEGATIVE_WORDS =
  /\b(rude|long wait|waited (so |too )?long|waited for hours|dirty|wrong|slow|bad|terrible|awful|worst|poor|unhelpful|ignored|disappointed|angry|unacceptable|kotor|lambat|teruk|kurang ajar|biadab|sombong|kecewa|marah|tak puas hati|tidak puas hati|busuk|lama sangat|tunggu lama)\b/;

/** Words that put someone's safety in question, EN + BM. Any hit flags the case; the model can add to it, never clear it. */
const SAFETY_WORDS: { urgency: Urgency; pattern: RegExp }[] = [
  {
    urgency: "critical",
    pattern:
      /\b(suicid\w*|kill (myself|me)|self ?harm|hurt (myself|me)|abuse\w*|assault\w*|harass\w*|molest\w*|violen\w*|threat\w*|hit me|slapped|sexual\w*|bunuh diri|cederakan diri|didera|mendera|penderaan|cabul|gangguan seksual|dipukul|ugut\w*|diugut|ancam\w*|diancam|ganas)\b/,
  },
  {
    urgency: "high",
    pattern:
      /\b(fell|fall(en|ing)?|slipped|tripped|jatuh|terjatuh|tergelincir|wrong (medicine|medication|drug|dose|patient|blood)|salah ubat|ubat salah|salah dos|salah pesakit|overdose|allergic reaction|alahan|injur\w*|cedera|bleeding|berdarah|burn(ed|t)?|terbakar|fire|kebakaran|unsafe|dangerous|bahaya|infection|jangkitan|neglect\w*|diabaikan)\b/,
  },
];

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function ratingLabel(rating: number): string {
  return RATING_LABELS[rating] || String(rating);
}

export const higherUrgency = (a: Urgency, b: Urgency): Urgency =>
  URGENCIES.indexOf(a) >= URGENCIES.indexOf(b) ? a : b;

const asUrgency = (value: string | undefined): Urgency =>
  (URGENCIES as readonly string[]).includes(value ?? "") ? (value as Urgency) : "low";

const firstWords = (text: string, count: number) => {
  const words = text.trim().split(/\s+/);
  return words.length > count ? `${words.slice(0, count).join(" ")}…` : text.trim();
};

/** The classification from rules alone — what is filed when the model is off, and the floor under what it says. */
export function ruleTriage(rating: number, area: string, comment: string): FeedbackTriage {
  const text = fold(comment);
  const safety = SAFETY_WORDS.find((s) => s.pattern.test(text));
  const negative = rating <= 2 || NEGATIVE_WORDS.test(text) || Boolean(safety);
  const fromArea: Category[] = area === "Billing" ? ["billing"] : area === "Facilities" ? ["facilities"] : [];
  const fromWords = (Object.keys(CATEGORY_WORDS) as Exclude<Category, "other">[]).filter((c) => CATEGORY_WORDS[c].test(text));
  const categories = [...new Set<Category>([...fromWords, ...fromArea])];
  return {
    sentiment: negative ? "negative" : rating >= 4 ? "positive" : "neutral",
    categories: categories.length ? categories : ["other"],
    urgency: safety?.urgency ?? (negative ? "medium" : "low"),
    safetyFlag: Boolean(safety),
    summary: firstWords(`${ratingLabel(rating)} — ${area || "visit"}${comment.trim() ? `: ${comment.trim()}` : ""}`, 20),
    classifiedBy: "rules",
  };
}

/** The model may raise urgency, add categories or flag safety; whatever the rules found stays. */
export function mergeTriage(rules: FeedbackTriage, model: Omit<FeedbackTriage, "classifiedBy">): FeedbackTriage {
  const categories = [...new Set<Category>([...rules.categories, ...model.categories])];
  const known = categories.filter((c) => c !== "other");
  return {
    sentiment: rules.sentiment === "negative" ? "negative" : model.sentiment,
    categories: known.length ? known : ["other"],
    urgency: higherUrgency(rules.urgency, model.urgency),
    safetyFlag: rules.safetyFlag || model.safetyFlag,
    summary: model.summary.trim() ? firstWords(model.summary, 20) : rules.summary,
    classifiedBy: "llm",
  };
}

export function triageData(triage: FeedbackTriage): Record<string, string> {
  return {
    sentiment: triage.sentiment,
    categories: triage.categories.join(","),
    urgency: triage.urgency,
    safetyFlag: triage.safetyFlag ? "yes" : "no",
    summary: triage.summary,
    classifiedBy: triage.classifiedBy,
  };
}

/** Officer review for negative, urgent or unsafe feedback; the rules are re-run so a missing classification never hides a hit. */
export function feedbackEscalation(data: Record<string, string>): string | null {
  const rating = Number(data.rating);
  const area = data.area || "the visit";
  const rules = ruleTriage(rating, data.area ?? "", data.comment ?? "");
  const urgency = higherUrgency(rules.urgency, asUrgency(data.urgency));
  if (rules.safetyFlag || data.safetyFlag === "yes") {
    return `Safety concern reported about ${area} (${urgency} urgency) — patient relations to follow up today.`;
  }
  if (urgency === "high" || urgency === "critical") {
    return `Urgent feedback about ${area} (${urgency} urgency) — needs a follow-up.`;
  }
  if (rules.sentiment === "negative") {
    return `Negative feedback about ${area} (rated ${ratingLabel(rating)}) — needs a follow-up.`;
  }
  return null;
}

export function feedbackResult(
  rating: number,
  area: string,
  comment: string,
  filed: { caseId: string; status: string; data?: Record<string, string> },
): ServiceResult {
  const followUp = filed.status === "officer_review";
  const safety = filed.data?.safetyFlag === "yes" || ruleTriage(rating, area, comment).safetyFlag;
  const topics = (filed.data?.categories ?? "")
    .split(",")
    .filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c) && c !== "other")
    .map((c) => CATEGORY_LABELS[c]);
  return {
    title: "Thank you for your feedback",
    rows: [
      { label: "Rating", value: ratingLabel(rating) },
      { label: "Area", value: area },
      ...(topics.length ? [{ label: "About", value: topics.join(", ") }] : []),
      { label: followUp ? "Follow-up ticket" : "Reference", value: filed.caseId },
    ],
    note: followUp
      ? `A patient-relations officer will follow this up. Quote ${filed.caseId} at Patient Affairs, Block A Level 1.` +
        (safety ? " If anyone is in danger right now, please tell any staff member or go to the Emergency Department in Block D." : "")
      : "Thank you — your feedback helps us improve.",
  };
}
