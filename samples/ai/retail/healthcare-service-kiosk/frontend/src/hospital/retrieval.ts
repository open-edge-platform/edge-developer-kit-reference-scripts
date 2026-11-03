// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Small BM25 over the kiosk's curated guides, with English/Malay synonyms folded into one vocabulary. */

const STOPWORDS = new Set(
  (
    "a an the and or but if of to in on at for from by with about as is are was were be been being am do does did " +
    "i me my we our you your he she it its they them their this that these those there here what which who whom " +
    "when where why how can could would should will shall may might must have has had get got any some much many " +
    "please tell know want need like just also so than then too very not no yes ok okay hi hello thanks thank " +
    "hospital kiosk " +
    "yang dan atau di ke dari untuk dengan ini itu apa apakah bila bilakah mana manakah bagaimana macam mana " +
    "boleh saya kami kita anda awak dia mereka ada tak tidak nak hendak mahu ingin perlu sila tolong ya la lah kah " +
    "pukul berapa"
  ).split(" "),
);

const PHRASES: [RegExp, string][] = [
  [/\bwi fi\b/g, "wifi"],
  [/\bcar park\b/g, "parking"],
  [/\bletak kereta\b/g, "parking"],
  [/\bkerusi roda\b/g, "wheelchair"],
  [/\blost and found\b/g, "lost"],
  [/\bbarang hilang\b/g, "lost"],
  [/\bblood pressure\b/g, "hypertension"],
  [/\bdarah tinggi\b/g, "hypertension"],
  [/\btekanan darah\b/g, "hypertension"],
  [/\bkencing manis\b/g, "diabetes"],
  [/\bblood sugar\b/g, "diabetes"],
  [/\bgula darah\b/g, "diabetes"],
  [/\bcredit card\b/g, "card"],
  [/\bdebit card\b/g, "card"],
  [/\bkad kredit\b/g, "card"],
  [/\bmedical records?\b/g, "record"],
  [/\bmedical reports?\b/g, "record"],
  [/\bsign language\b/g, "interpreter"],
  [/\bmental health\b/g, "mental"],
  [/\bkesihatan mental\b/g, "mental"],
  [/\bberhenti merokok\b/g, "smoking"],
  [/\bquit smoking\b/g, "smoking"],
  [/\bmakan sihat\b/g, "diet"],
];

const SYNONYMS: Record<string, string[]> = {
  visit: ["visit", "visiting", "visitor", "visitors", "visits", "lawat", "melawat", "lawatan", "pelawat"],
  parking: ["parking", "park", "parked", "carpark", "parkir", "kereta", "car", "cars"],
  pay: ["pay", "paying", "payment", "payments", "bayar", "bayaran", "pembayaran", "cashless", "duitnow", "ewallet"],
  card: ["card", "cards", "kad"],
  pharmacy: ["pharmacy", "farmasi", "pharmacist", "pharmacists"],
  medicine: ["medicine", "medicines", "medication", "medications", "ubat", "ubatan", "drug", "drugs", "prescription", "preskripsi"],
  food: ["food", "eat", "eating", "meal", "meals", "makan", "makanan", "minum", "cafeteria", "canteen", "kantin", "cafe", "kafe", "restaurant", "lunch", "breakfast", "dinner"],
  prayer: ["prayer", "pray", "praying", "surau", "solat", "sembahyang", "musolla", "musollah", "mosque", "masjid"],
  wifi: ["wifi", "internet", "network", "rangkaian"],
  lost: ["lost", "found", "missing", "hilang", "tercicir", "tertinggal"],
  record: ["record", "records", "rekod", "report", "reports", "laporan"],
  interpreter: ["interpreter", "interpreters", "translator", "translate", "translation", "penterjemah", "terjemah", "bahasa", "language", "languages"],
  wheelchair: ["wheelchair", "wheelchairs", "kerusi", "oku", "disabled", "disability", "mobility"],
  atm: ["atm", "atms", "cash", "tunai", "withdraw", "bank"],
  admission: ["admission", "admissions", "admit", "admitted", "warded", "inpatient", "wad"],
  toilet: ["toilet", "toilets", "tandas", "restroom", "restrooms", "washroom", "bathroom"],
  hour: ["hour", "hours", "time", "times", "open", "opening", "close", "closing", "waktu", "masa", "jam", "buka", "tutup"],
  fever: ["fever", "demam", "temperature", "suhu", "panas"],
  flu: ["flu", "influenza", "cold", "colds", "selesema", "cough", "coughing", "batuk", "sneeze", "sneezing", "selsema"],
  dengue: ["dengue", "denggi", "aedes", "mosquito", "nyamuk"],
  hypertension: ["hypertension", "bp"],
  diabetes: ["diabetes", "diabetic", "glucose", "sugar", "gula"],
  diet: ["diet", "nutrition", "healthy", "sihat", "plate", "vegetable", "vegetables", "sayur"],
  vaccine: ["vaccine", "vaccines", "vaccination", "vaccinations", "vaksin", "suntikan", "jab", "jabs", "immunisation", "immunization", "imunisasi"],
  smoking: ["smoking", "smoke", "smoker", "rokok", "merokok", "cigarette", "cigarettes", "vape", "vaping", "nicotine", "mquit"],
  mental: ["mental", "stress", "stressed", "anxiety", "anxious", "depression", "depressed", "sad", "lonely", "tertekan", "murung", "kemurungan", "cemas", "sedih"],
  exercise: ["exercise", "exercising", "active", "activity", "senaman", "bersenam", "walking", "sport", "sports", "gym"],
  fasting: ["fasting", "fast", "puasa", "berpuasa"],
  complaint: ["complaint", "complaints", "complain", "aduan", "feedback", "compliment", "compliments"],
  information: ["information", "info", "maklumat", "enquiry", "enquiries", "pertanyaan", "help", "bantuan"],
  child: ["child", "children", "kid", "kids", "anak", "baby", "bayi", "paediatric", "pediatric"],
  xray: ["xray", "x", "ray", "scan", "scans", "imaging", "mri", "ct", "ultrasound"],
  heart: ["heart", "jantung", "cardiac", "cardiology", "ecg"],
  skin: ["skin", "kulit", "rash", "eczema", "dermatology"],
  bone: ["bone", "bones", "tulang", "joint", "joints", "fracture", "orthopaedic", "orthopaedics", "orthopedic"],
  blood: ["blood", "darah", "lab", "laboratory", "makmal", "urine"],
  emergency: ["emergency", "kecemasan", "urgent", "accident", "kemalangan", "ae"],
  pregnancy: ["pregnancy", "pregnant", "hamil", "mengandung", "antenatal", "obgyn", "gynaecology", "maternity"],
};

const CANONICAL = new Map<string, string>(
  Object.entries(SYNONYMS).flatMap(([canonical, words]) => [
    [canonical, canonical] as [string, string],
    ...words.map((word) => [word, canonical] as [string, string]),
  ]),
);

function fold(text: string): string {
  let t = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ");
  for (const [pattern, canonical] of PHRASES) t = t.replace(pattern, canonical);
  return t.trim();
}

function canon(word: string): string {
  const direct = CANONICAL.get(word);
  if (direct) return direct;
  const stem = word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
  return CANONICAL.get(stem) ?? stem;
}

/** The searchable terms of a text: folded, stop-words dropped, synonyms collapsed to one canonical word. */
export function searchTerms(text: string): string[] {
  return fold(text)
    .split(" ")
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(canon);
}

export type Hit<T> = { doc: T; score: number; matched: string[] };

const K1 = 1.2;
const B = 0.75;

/** `fields` returns the text to index per doc; repeat a field to weight it (titles, keywords). */
export function bm25Index<T>(docs: T[], fields: (doc: T) => string[]) {
  const docTerms = docs.map((doc) => searchTerms(fields(doc).join(" ")));
  const frequencies = docTerms.map((terms) => {
    const tf = new Map<string, number>();
    for (const term of terms) tf.set(term, (tf.get(term) ?? 0) + 1);
    return tf;
  });
  const df = new Map<string, number>();
  for (const tf of frequencies) for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const avgLength = docTerms.reduce((sum, terms) => sum + terms.length, 0) / Math.max(1, docs.length);
  const idf = (term: string) => {
    const n = df.get(term) ?? 0;
    return Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
  };

  return (query: string, limit = 3): Hit<T>[] => {
    const terms = [...new Set(searchTerms(query))];
    if (terms.length === 0) return [];
    return docs
      .map((doc, i) => {
        const tf = frequencies[i];
        const norm = K1 * (1 - B + (B * docTerms[i].length) / avgLength);
        let score = 0;
        const matched: string[] = [];
        for (const term of terms) {
          const f = tf.get(term) ?? 0;
          if (!f) continue;
          score += (idf(term) * f * (K1 + 1)) / (f + norm);
          matched.push(term);
        }
        return { doc, score, matched };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  };
}
