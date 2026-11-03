// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type RedFlag = { id: string; label: string; crisis?: boolean };

const RED_FLAG_RULES: (RedFlag & { patterns: RegExp[] })[] = [
  {
    id: "chest",
    label: "chest pain",
    patterns: [
      /\bchest (pain|tight|tightness|pressure|discomfort|hurts?|hurting)\b/,
      /\b(pain|tightness|pressure) (in|on) (my|the|his|her) chest\b/,
      /\bheart attack\b/,
      /\bsakit dada\b/,
      /\bdada (sakit|sesak|ketat|berat)\b/,
      /\bserangan jantung\b/,
    ],
  },
  {
    id: "breathing",
    label: "trouble breathing",
    patterns: [
      /\b(cant|cannot|can not|unable to|hard to|struggling to|difficult to|trouble|difficulty|problem) (breath|breathe|breathing)\b/,
      /\bshort(ness)? of breath\b/,
      /\bbreathless\b/,
      /\bchoking\b/,
      /\bsesak nafas\b/,
      /\b(susah|sukar|tak boleh|tidak boleh) (nak )?bernafas\b/,
      /\btercungap\b/,
      /\btercekik\b/,
    ],
  },
  {
    id: "stroke",
    label: "stroke signs",
    patterns: [
      /\bstrokes?\b/,
      /\bface (is )?(droop|drooping|drooped)\b/,
      /\b(slurred|slurring) speech\b/,
      /\b(weak|weakness|numb|numbness) (in|on) one side\b/,
      /\bone side of (my|the|his|her) (body|face)\b/,
      /\bangin ahmar\b/,
      /\bstrok\b/,
      /\bmulut (herot|senget)\b/,
      /\blemah sebelah\b/,
    ],
  },
  {
    id: "bleeding",
    label: "bleeding",
    patterns: [
      /\bbleed(ing)?\b/,
      /\bbled\b/,
      /\b(vomiting|coughing|cough|vomit|vomited) (up )?blood\b/,
      /\bblood in (my|the) (vomit|stool|stools|poo|urine)\b/,
      /\bberdarah\b/,
      /\bpendarahan\b/,
      /\b(muntah|batuk|berak|kencing) darah\b/,
    ],
  },
  {
    id: "fainting",
    label: "fainting",
    patterns: [
      /\bfaint(ed|ing|s)?\b/,
      /\bpass(ed|ing|es)? out\b/,
      /\bcollaps(e|ed|es|ing)\b/,
      /\bunconscious\b/,
      /\b(not|wont|isnt) (waking|wake|responding)\b/,
      /\bpengsan\b/,
      /\bpitam\b/,
      /\b(tak|tidak) sedarkan diri\b/,
    ],
  },
  {
    id: "seizure",
    label: "a seizure",
    patterns: [/\bseizures?\b/, /\bconvuls/, /\bhaving (a )?fits?\b/, /\bsawan\b/, /\bkejang\b/],
  },
  {
    id: "anaphylaxis",
    label: "a severe allergic reaction",
    patterns: [
      /\banaphyla/,
      /\b(throat|tongue|lips?|face) (is |are )?(swelling|swollen|closing)\b/,
      /\bswollen (throat|tongue|lips?)\b/,
      /\b(severe |bad )?allergic reaction\b/,
      /\bbengkak (tekak|lidah|bibir|muka)\b/,
      /\balahan (teruk|serius)\b/,
    ],
  },
  {
    id: "overdose",
    label: "an overdose or poisoning",
    patterns: [
      /\boverdos/,
      /\b(took|taken|swallowed) too many\b/,
      /\bpoisoned\b/,
      /\b(swallowed|drank|drunk) (bleach|poison|pesticide|racun)\b/,
      /\bterlebih (makan |ambil )?ubat\b/,
      /\bminum racun\b/,
    ],
  },
  {
    id: "self-harm",
    label: "thoughts of suicide or self-harm",
    crisis: true,
    patterns: [
      /\bsuicid/,
      /\bkill (myself|me)\b/,
      /\bend (my life|it all)\b/,
      /\bwant to die\b/,
      /\bhurt(ing)? myself\b/,
      /\bself ?harm/,
      /\bbunuh diri\b/,
      /\b(nak|ingin|mahu) mati\b/,
      /\bcederakan diri\b/,
      /\b(tak|tidak) (nak|mahu|ingin) hidup\b/,
    ],
  },
  {
    id: "pregnancy",
    label: "bleeding or pain in pregnancy",
    patterns: [
      /\b(pregnan\w*|hamil|mengandung)\b.*\b(bleed\w*|blood|spotting|pain|cramps?|darah|sakit|tumpah)\b/,
      /\b(bleed\w*|blood|spotting|pain|cramps?|darah|sakit)\b.*\b(pregnan\w*|hamil|mengandung)\b/,
      /\bwaters? (has |have )?(broken|broke)\b/,
      /\bair ketuban\b/,
      /\bbaby (is )?not moving\b/,
      /\bbayi (tak|tidak) bergerak\b/,
    ],
  },
  {
    id: "infant-fever",
    label: "a fever in a young baby",
    patterns: [
      /\b(baby|babies|infant|newborn|bayi)\b.*\b(fever|feverish|temperature|demam|panas)\b/,
      /\b(fever|feverish|temperature|demam|panas)\b.*\b(baby|babies|infant|newborn|bayi)\b/,
    ],
  },
];

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Symptoms that must go to the Emergency Department, in English or Malay. Checked before anything else answers. */
export function redFlag(text: string): RedFlag | null {
  const t = fold(text);
  if (!t) return null;
  const rule = RED_FLAG_RULES.find((r) => r.patterns.some((p) => p.test(t)));
  return rule ? { id: rule.id, label: rule.label, ...(rule.crisis ? { crisis: true } : {}) } : null;
}

const MEDICINE =
  "(medicines?|medications?|meds|tablets?|pills?|insulin|drugs?|antibiotics?|panadol|paracetamol|ibuprofen|aspirin|" +
  "vitamins?|supplements?|injections?|inhalers?|ubat|\\w+(?:pril|olol|statin|formin|sartan|dipine|cillin|mycin|prazole))";

const PERSONAL_ADVICE: RegExp[] = [
  new RegExp(`\\b(should|can|could|may|must) i\\b.*\\b${MEDICINE}\\b`),
  new RegExp(`\\bhow (much|many|often|long)\\b.*\\b${MEDICINE}\\b`),
  new RegExp(`\\b(stop|stopping|change|changing|skip|skipping|increase|reduce|double|switch)\\b.*\\bmy ${MEDICINE}\\b`),
  new RegExp(`\\bmy ${MEDICINE}\\b.*\\b(stop|change|skip|increase|reduce|double|switch|more|less|enough|too much)\\b`),
  /\b(dose|doses|dosage|dosing)\b/,
  /\bis it (safe|ok|okay|alright|fine) (for me )?to (take|stop|mix|combine|skip)\b/,
  /\bdo i have\b/,
  /\bam i (sick|ill|pregnant|diabetic|dying|infected)\b/,
  /\bwhats? (is )?wrong with me\b/,
  /\bdiagnos/,
  /\b(boleh|patut|perlu|bolehkah|patutkah) (ke )?(saya )?(berhenti|stop|tambah|kurangkan|kurang|ambil|makan|minum|tukar) ubat/,
  /\bberhenti (makan |ambil )?ubat\b/,
  /\bberapa (biji|banyak|kali)\b.*\bubat\b/,
  /\bubat\b.*\bberapa (biji|banyak|kali)\b/,
  /\bdos\b/,
  /\bsaya (sakit|ada) apa\b/,
];

/** Questions about the asker's own medicines, doses or diagnosis — for a doctor or pharmacist, never the kiosk. */
export function asksPersonalAdvice(text: string): boolean {
  const t = fold(text);
  return PERSONAL_ADVICE.some((p) => p.test(t));
}
