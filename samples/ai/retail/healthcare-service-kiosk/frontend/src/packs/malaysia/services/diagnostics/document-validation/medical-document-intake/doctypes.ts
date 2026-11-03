// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { letterhead, pickDate } from "@/lib/document-fields";

export type DocTypeId =
  | "lab"
  | "imaging"
  | "discharge"
  | "referral"
  | "prescription"
  | "mc"
  | "gl"
  | "vaccination"
  | "other";

type DocType = { id: DocTypeId; label: string; noun: string; loinc?: { code: string; display: string } };

// 11502-2 and 18748-4 are not yet verified against the LOINC release.
export const DOC_TYPES: DocType[] = [
  { id: "lab", label: "Lab report", noun: "a lab report", loinc: { code: "11502-2", display: "Laboratory report" } },
  {
    id: "imaging",
    label: "Imaging report",
    noun: "an imaging report",
    loinc: { code: "18748-4", display: "Diagnostic imaging study" },
  },
  {
    id: "discharge",
    label: "Discharge summary",
    noun: "a discharge summary",
    loinc: { code: "18842-5", display: "Discharge summary" },
  },
  { id: "referral", label: "Referral letter", noun: "a referral letter", loinc: { code: "57133-1", display: "Referral note" } },
  { id: "prescription", label: "Prescription", noun: "a prescription" },
  { id: "mc", label: "Medical certificate (MC)", noun: "a medical certificate" },
  { id: "gl", label: "Insurance guarantee letter", noun: "an insurance guarantee letter" },
  { id: "vaccination", label: "Vaccination record", noun: "a vaccination record" },
  { id: "other", label: "Something else", noun: "another medical document" },
];

export const DOC_TYPE_IDS = DOC_TYPES.map((t) => t.id) as [DocTypeId, ...DocTypeId[]];

export const docType = (id: string | null | undefined) => DOC_TYPES.find((t) => t.id === id);
export const isDocType = (id: string | null | undefined): id is DocTypeId => Boolean(docType(id));

/** Cue pattern and weight; each pattern counts once. Titles weigh 4, telling phrases 2–3, vocabulary 1. */
const CUES: Record<Exclude<DocTypeId, "other">, [RegExp, number][]> = {
  lab: [
    [/\b(?:laboratory|lab)\s+report\b|laporan\s+makmal/i, 4],
    [/reference\s+range|julat\s+rujukan|ref\.?\s+range|normal\s+range/i, 3],
    [/\bspecimen\b|spesimen|\bsample\s+(?:date|type|collected)|tarikh\s+sampel/i, 2],
    [/full\s+blood\s+count|\bFBC\b|renal\s+profile|lipid\s+profile|liver\s+function|\bHbA1c\b|urinalysis/i, 2],
    [/mmol\/l|mg\/dl|g\/dl|\bu\/l\b|x\s*10\^?9\/l|[µu]mol\/l/i, 2],
    [/\b(?:ha?emoglobin|platelets?|wbc|creatinine|glucose|cholesterol)\b/i, 1],
    [/patholog|patologi|\bmakmal\b/i, 1],
  ],
  imaging: [
    [/radiology\s+report|imaging\s+report|laporan\s+(?:radiologi|pengimejan)/i, 4],
    [/\bimpression\s*:|\bradiologist\b|pakar\s+radiologi/i, 2],
    [/\b(?:CT|MRI|X-?RAY|ultrasound|ultrasonography|USG|mammogra(?:m|phy)|CXR|sinar-?x)\b/i, 2],
    [/\b(?:findings|technique|contrast|impression|kesimpulan)\b/i, 1],
  ],
  discharge: [
    [/discharge\s+summary|ringkasan\s+discaj|ringkasan\s+keluar\s+wad|discharge\s+note/i, 4],
    [/date\s+of\s+(?:admission|discharge)|(?:admission|discharge)\s+date|tarikh\s+(?:masuk|discaj|keluar)/i, 3],
    [/principal\s+diagnosis|final\s+diagnosis|diagnosis\s+(?:on|at)\s+discharge|hospital\s+course/i, 2],
    [/\bward\b|\bwad\b|length\s+of\s+stay|discharge\s+medication/i, 1],
  ],
  referral: [
    [/referral\s+letter|surat\s+rujukan|rujukan\s+perubatan|letter\s+of\s+referral/i, 4],
    [/kindly\s+see|thank\s+you\s+for\s+seeing|\bdirujuk\b|reason\s+for\s+referral|sebab\s+rujukan|refer(?:red)?\s+to\s+you/i, 3],
    [/\bdear\s+(?:dr|doctor|colleague)|yang\s+berbahagia|\bkepada\b/i, 1],
  ],
  prescription: [
    [/\bprescription\b|\bpreskripsi\b/i, 4],
    [/(?:^|\s)Rx\b|℞/m, 3],
    [/\b(?:tds|tid|qid|prn|nocte|bd|bid)\b/i, 2],
    [/\b\d+(?:\.\d+)?\s?(?:mg|mcg|ml)\b/i, 1],
    [/\b(?:tablets?|tab|capsules?|cap|syrup|sirap|ubat)\b/i, 1],
    [/dispense|pharmacist|ahli\s+farmasi/i, 1],
  ],
  mc: [
    [/medical\s+certificate|sijil\s+(?:cuti\s+)?sakit|sijil\s+perubatan|\bMC\b/i, 4],
    [/unfit\s+for\s+(?:duty|work|school)|tidak\s+layak\s+(?:bertugas|bekerja)|cuti\s+sakit|sick\s+leave/i, 3],
    [/\b\d+\s*(?:days?|hari)\b/i, 1],
  ],
  gl: [
    [/guarantee\s+letter|surat\s+jaminan|letter\s+of\s+guarantee|\bGL\b/i, 4],
    [/admission\s+(?:approved|guaranteed)|we\s+(?:hereby\s+)?guarantee|jaminan\s+bayaran|approved\s+amount/i, 3],
    [/\b(?:insurer|takaful|policy\s+(?:no|number)|member\s+(?:id|no)|coverage|TPA|third\s+party\s+administrator)\b/i, 1],
  ],
  vaccination: [
    [/vaccination|immuni[sz]ation|vaksinasi|imunisasi|sijil\s+vaksin/i, 4],
    [/\bdose\s*\d|\bdos\s*\d|batch\s+(?:no|number)|booster/i, 2],
    [/\b(?:BCG|MMR|DTaP|hepatitis\s+b|HPV|influenza|COVID-19|comirnaty|sinovac)\b/i, 1],
  ],
};

/** Below either, the keyword guess is too close to call alone and the model is asked as well. */
export const KEYWORD_MIN_SCORE = 4;
export const KEYWORD_MIN_MARGIN = 3;

export type Classification = {
  /** The best guess; "other" when nothing in the text points anywhere. */
  type: DocTypeId;
  confidence: number;
  method: "keywords" | "model" | "manual";
  docDate: string | null;
  issuer: string | null;
};

export type KeywordScore = { type: DocTypeId; score: number; margin: number };

export function scoreDocument(text: string): KeywordScore {
  const scored = Object.entries(CUES)
    .map(([type, cues]) => ({
      type: type as DocTypeId,
      score: cues.reduce((sum, [cue, weight]) => sum + (cue.test(text) ? weight : 0), 0),
    }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  return best.score > 0
    ? { type: best.type, score: best.score, margin: best.score - next.score }
    : { type: "other", score: 0, margin: 0 };
}

export const needsModel = (s: KeywordScore) => s.score < KEYWORD_MIN_SCORE || s.margin < KEYWORD_MIN_MARGIN;

const ISSUER =
  /\b(hospital|klinik|clinic|poliklinik|makmal|laborator(?:y|ies)|patholog\w*|patologi|medical|pusat|cent(?:re|er)|bhd|berhad|pharmacy|farmasi|radiolog\w*|imaging|diagnostics?|insurans|insurance|takaful|assurance)\b/i;
export const DOC_DATE_AVOID = /(lahir|birth|dob|expiry|tamat)/i;

export function documentDate(text: string): string | null {
  return pickDate(
    text,
    [
      /(report(?:ed)?\s*(?:date|on)|tarikh\s+laporan|date\s+of\s+discharge|discharge\s+date|tarikh\s+(?:discaj|keluar)|date\s+(?:of\s+)?issue|tarikh\s+dikeluarkan|date\s+of\s+(?:examination|study|vaccination)|tarikh\s+(?:pemeriksaan|vaksinasi))/i,
      /(tarikh|date|dated|bertarikh)/i,
    ],
    DOC_DATE_AVOID,
  );
}

export const documentIssuer = (text: string) => letterhead(text, ISSUER);

export function classifyByKeywords(text: string): Classification {
  const s = scoreDocument(text);
  return {
    type: s.type,
    confidence: s.score === 0 ? 0 : Math.round((s.score / (s.score + (s.score - s.margin) + 2)) * 100) / 100,
    method: "keywords",
    docDate: documentDate(text),
    issuer: documentIssuer(text),
  };
}

export const MANUAL_CLASSIFICATION: Classification = {
  type: "other",
  confidence: 0,
  method: "manual",
  docDate: null,
  issuer: null,
};

// Keep in step with the touch confirm (steps/application.tsx).
export function typeQuestion(guess: DocTypeId | null | undefined): string {
  const known = guess && guess !== "other" ? docType(guess) : undefined;
  return known ? `It looks like ${known.noun} — is that right?` : "What kind of document is this?";
}

/** The guess first as the one-tap yes, then every other kind. */
export function typeOptions(guess: DocTypeId | null | undefined): { value: DocTypeId; label: string }[] {
  const known = guess && guess !== "other" ? docType(guess) : undefined;
  return [
    ...(known ? [{ value: known.id, label: `Yes — ${known.label.toLowerCase()}` }] : []),
    ...DOC_TYPES.filter((t) => t.id !== known?.id).map((t) => ({ value: t.id, label: t.label })),
  ];
}

/** A FHIR DocumentReference-shaped summary for the filed case; `classification` is the kiosk's own extension. */
export function documentReference(c: Classification, chosen: DocTypeId, uploadedAt: string) {
  const type = docType(chosen);
  return {
    resourceType: "DocumentReference",
    status: "current",
    type: {
      coding: type?.loinc ? [{ system: "http://loinc.org", ...type.loinc }] : [],
      text: type?.label ?? chosen,
    },
    date: uploadedAt,
    author: c.issuer ? [{ display: c.issuer }] : [],
    content: [{ attachment: { contentType: "application/pdf", ...(c.docDate ? { creation: c.docDate } : {}) } }],
    classification: {
      guess: c.type,
      method: c.method,
      confidence: c.confidence,
      confirmedBy: "patient",
      changed: chosen !== c.type,
    },
  };
}

export function intakeData(c: Classification, chosen: DocTypeId, uploadedAt: string): Record<string, string> {
  const type = docType(chosen);
  return {
    docType: chosen,
    docTypeLabel: type?.label ?? chosen,
    docTypeGuess: c.type,
    docTypeConfirmed: chosen === c.type ? "yes" : "changed",
    docLoinc: type?.loinc?.code ?? "",
    docDate: c.docDate ?? "",
    docIssuer: c.issuer ?? "",
    docClassifier: c.method,
    docConfidence: String(c.confidence),
    docSource: uploadedAt,
    documentReference: JSON.stringify(documentReference(c, chosen, uploadedAt)),
  };
}
