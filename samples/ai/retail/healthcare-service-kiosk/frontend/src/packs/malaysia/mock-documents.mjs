// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The Malaysian mock documents, rendered in memory. Layouts follow the real
 * documents (field order, bilingual labels, reference-number formats) so
 * they behave like real scans in the OCR + LLM pipeline. All data is
 * fictional, and each PDF's Subject metadata marks it as a test fixture
 * (metadata is invisible to OCR, so it can't skew the analysis).
 *
 * The kiosk's simulated scanner renders the documents of the patient being
 * served (src/app/api/_lib/mock-documents.ts); /mock-documents hands them to
 * staff to print or to feed to that scanner; scripts/gen-mock-docs.mjs
 * writes them to assets/mocks. Plain JS with no imports beyond pdfkit and
 * bwip-js, so the CLI can load it without the app's bundler.
 */
import { toBuffer as barcodePng } from "bwip-js/node";
import PDFDocument from "pdfkit";

/* The year the seed's ages count to — SEED_AGE_YEAR in src/app/api/_lib/citizens.ts. */
const SEED_AGE_YEAR = 2026;

/* First names in data/citizens.csv, for the gender fields printed on docs. */
const FEMALE = new Set(["AINA", "ANH", "FARAH", "JIA", "LINH", "NADIA", "NGA", "NUR", "SITI", "TRANG"]);

/** Slug rebuilt character-by-character from this literal alphabet, so the
 *  citizen name from the CSV/DB never flows into a filesystem path. */
const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function slugOf(name) {
  let out = "";
  for (const ch of `${name}`.toLowerCase()) {
    const at = SLUG_ALPHABET.indexOf(ch);
    out += at === -1 ? "-" : SLUG_ALPHABET[at];
  }
  return out.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/** Passport country codes (ICAO 9303) for the registry's countries. */
const ICAO = { Malaysia: "MYS", Vietnam: "VNM" };
const NATIONALITY = { Malaysia: "MALAYSIAN", Vietnam: "VIETNAMESE" };

/**
 * Person model for the document builders, from a citizens.csv-shaped row.
 * A recorded DateOfBirth (ISO) and Sex win; otherwise the date of birth uses
 * the same formula as src/app/api/_lib/citizens.ts (day/month from CitizenKey,
 * year from age at SEED_AGE_YEAR). The printed ID number is the registry
 * citizenId, so the LLM's holder cross-check (name, national ID) genuinely
 * passes on a "true" document.
 *
 * What only the server knows rides in on optional fields: `Mrn` (the patient
 * card), `Slip` (today's appointment and its signed barcode payload) and `Policy`
 * (the insurer and policy on the hospital's record, so the insurance card
 * matches it). Without them those documents are left out or made up.
 */
export function person(row) {
  const key = Number(row.CitizenKey);
  const age = Number(row.Age) || 30;
  const name = row.SyntheticName.toUpperCase();
  const id = row.SyntheticCitizenID.toUpperCase();
  const digits = id.replace(/\D/g, "").padEnd(10, "0");
  const recorded = /^(\d{4})-(\d{2})-(\d{2})/.exec(row.DateOfBirth ?? "");
  const month = recorded ? Number(recorded[2]) - 1 : key % 12;
  const day = recorded ? Number(recorded[3]) : 1 + ((key * 13) % 28);
  const year = recorded ? Number(recorded[1]) : SEED_AGE_YEAR - age;
  const dd = String(day).padStart(2, "0");
  const mm = String(month + 1).padStart(2, "0");
  const female = row.Sex ? row.Sex === "female" : FEMALE.has(row.SyntheticName.split(" ")[0].toUpperCase());
  const country = row.Country || "Malaysia";
  return {
    key,
    age,
    name,
    id,
    icCompact: digits,
    digits,
    female,
    jantina: female ? "PEREMPUAN" : "LELAKI",
    dobDash: `${dd}-${mm}-${year}`,
    city: row.City.toUpperCase(),
    address: `${row.AddressLine}, ${row.Postcode} ${row.City}, ${row.Country}`.toUpperCase(),
    phone: row.Phone,
    country,
    foreign: country !== "Malaysia",
    countryCode: ICAO[country] ?? "XXX",
    nationality: NATIONALITY[country] ?? country.toUpperCase(),
    dob: { day, month, year },
    mrn: row.Mrn || null,
    slip: row.Slip ?? null,
    policy: row.Policy ?? null,
    slug: `${key}-${slugOf(row.SyntheticName)}`,
  };
}

/**
 * Tampered variant of a person for the "false" documents. The donor is a
 * different registry citizen; every mode plants at least one printed detail
 * that belongs to someone else, which the LLM verification must reject.
 */
function tamper(p, donor, mode) {
  if (mode === "holder") {
    return {
      person: { ...donor, key: p.key, slug: p.slug },
      note: `entire document belongs to ${donor.name} (${donor.id}), not ${p.name}`,
    };
  }
  // mode === "id"
  const altered = p.id.replace(/\d/g, (ch) => String((Number(ch) + 3) % 10));
  return {
    person: { ...p, id: altered, icCompact: altered.replace(/\D/g, "").padEnd(10, "0") },
    note: `ID number altered to ${altered} (registry says ${p.id})`,
  };
}

/* --------------------------------------------------------------- pdf helpers */

const PAGE = { w: 595.28, h: 841.89, margin: 50 };
const RIGHT = PAGE.w - PAGE.margin;

async function render(title, tampered, build) {
  const images = build.images ? await build.images() : {};
  return new Promise((resolve, reject) => {
    const d = new PDFDocument({
      size: "A4",
      margin: PAGE.margin,
      info: {
        Title: title,
        Subject:
          "Mock test fixture with fictional data — kiosk prototype, not a genuine document" +
          (tampered ? ` — DELIBERATELY TAMPERED for mismatch demos (${tampered})` : ""),
      },
    });
    const chunks = [];
    d.on("data", (chunk) => chunks.push(chunk));
    d.on("end", () => resolve(Buffer.concat(chunks)));
    d.on("error", reject);

    build(d, images);

    d.end();
  });
}

const hr = (d, color = "#0a1f44", width = 1.2) => {
  d.moveTo(PAGE.margin, d.y).lineTo(RIGHT, d.y).lineWidth(width).strokeColor(color).stroke();
  d.moveDown(0.8);
};

const header = (d, lines) => {
  lines.forEach(([text, size, color = "#0a1f44", font = "Helvetica-Bold"]) => {
    d.fontSize(size).fillColor(color).font(font).text(text, { align: "center" });
  });
  d.moveDown(0.4);
  hr(d);
};

const kv = (d, label, value, opts = {}) => {
  const labelWidth = opts.labelWidth ?? 190;
  const y = d.y;
  d.fontSize(9.5).fillColor("#444444").font("Helvetica").text(label, PAGE.margin, y, { width: labelWidth });
  d.fontSize(10).fillColor("#111111").font("Helvetica-Bold")
    .text(value, PAGE.margin + labelWidth + 8, y, { width: RIGHT - PAGE.margin - labelWidth - 8 });
  d.moveDown(0.45);
};

const sectionTitle = (d, text) => {
  d.moveDown(0.4);
  d.fontSize(10).fillColor("#0a1f44").font("Helvetica-Bold").text(text, PAGE.margin);
  d.moveDown(0.3);
};

/* ---------------------------------------------------------------- MyKad copy */
const mykadCopy = (P) => (d) => {
  header(d, [
    ["SALINAN KAD PENGENALAN (DEPAN & BELAKANG)", 13],
    ["MYKAD PHOTOCOPY — FRONT & BACK", 9.5, "#333333", "Helvetica"],
  ]);

  const cardW = 320;
  const cardH = 200;
  const cardX = (PAGE.w - cardW) / 2;

  // Front face
  let y = d.y + 6;
  d.roundedRect(cardX, y, cardW, cardH, 12).lineWidth(1).strokeColor("#8aa0c8").stroke();
  d.roundedRect(cardX, y, cardW, 34, 12).fillColor("#dce7f7").fill();
  d.fontSize(10).fillColor("#0a1f44").font("Helvetica-Bold").text("KAD PENGENALAN", cardX + 14, y + 7);
  d.fontSize(7.5).fillColor("#54607a").font("Helvetica").text("MALAYSIA  ·  MYKAD", cardX + 14, y + 20);
  // Chip
  d.roundedRect(cardX + 16, y + 52, 34, 28, 4).lineWidth(1).strokeColor("#b39b45").stroke();
  d.fontSize(5.5).fillColor("#b39b45").text("CIP", cardX + 27, y + 62);
  d.fontSize(15).fillColor("#111111").font("Helvetica-Bold").text(P.id, cardX + 62, y + 46);
  d.fontSize(10).text(P.name, cardX + 62, y + 74, { width: 160 });
  d.fontSize(7.5).fillColor("#333333").font("Helvetica")
    .text(P.address, cardX + 62, y + 102, { width: 150 });
  d.fontSize(8).fillColor("#111111").font("Helvetica-Bold").text("WARGANEGARA", cardX + 62, y + 156);
  d.fontSize(8).text(P.jantina, cardX + 160, y + 156);
  // Photo placeholder + photo-box marker
  d.rect(cardX + cardW - 82, y + 48, 64, 78).lineWidth(0.8).strokeColor("#9aa5b8").stroke();
  d.fontSize(6.5).fillColor("#9aa5b8").font("Helvetica").text("FOTO", cardX + cardW - 60, y + 82);

  // Back face
  y += cardH + 22;
  d.roundedRect(cardX, y, cardW, cardH * 0.72, 12).lineWidth(1).strokeColor("#8aa0c8").stroke();
  d.fontSize(8).fillColor("#54607a").font("Helvetica").text("BELAKANG / BACK", cardX + 14, y + 10);
  d.fontSize(9.5).fillColor("#111111").font("Helvetica-Bold")
    .text(`${P.icCompact}-02`, cardX + 14, y + 34);
  d.fontSize(7.5).fillColor("#333333").font("Helvetica")
    .text(`TEMPAT LAHIR: ${P.city}`, cardX + 14, y + 54);
  d.text("JABATAN PENDAFTARAN NEGARA MALAYSIA", cardX + 14, y + 70);
  d.fontSize(6.5).fillColor("#9aa5b8")
    .text("CETAKAN KESELAMATAN · SECURITY PRINT", cardX + 14, y + 108);

  d.fontSize(9).fillColor("#555555").font("Helvetica")
    .text('Catatan: "SALINAN — UNTUK URUSAN RASMI SAHAJA"', PAGE.margin, y + cardH * 0.72 + 24);
};

/* ------------------------------------------------------------- date helpers */

const BULAN = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000);
const malayDate = (date) => `${date.getDate()} ${BULAN[date.getMonth()]} ${date.getFullYear()}`;

/* ------------------------------------------------------------ Referral letter */
const referralLetter = (P) => (d) => {
  header(d, [
    ["KLINIK KESIHATAN BANDAR", 13],
    ["SURAT RUJUKAN PERUBATAN / MEDICAL REFERRAL LETTER", 10, "#333333", "Helvetica"],
  ]);
  kv(d, "Tarikh / Date", malayDate(daysAgo(12)));
  kv(d, "Kepada / To", "Pakar Perunding Ortopedik (Jabatan Ortopedik), Hospital Kuala Lumpur");
  d.moveDown(0.3);
  kv(d, "Nama Pesakit / Patient Name", P.name);
  kv(d, P.foreign ? "No. Pasport / Passport No." : "No. K/P / IC No.", P.id);
  kv(d, "Tarikh Lahir / Date of Birth", P.dobDash);
  kv(d, "Jantina / Sex", P.jantina);
  kv(d, "No. Telefon / Phone", P.phone);
  sectionTitle(d, "SEBAB RUJUKAN / REASON FOR REFERRAL");
  d.fontSize(10).fillColor("#111111").font("Helvetica").text(
    `Pesakit ${P.name} dirujuk kerana sakit lutut kanan berterusan selama 3 bulan yang tidak pulih ` +
      "dengan rawatan awal. Mohon penilaian dan pengurusan lanjut oleh pakar ortopedik.",
    PAGE.margin,
    undefined,
    { width: RIGHT - PAGE.margin, lineGap: 4, align: "justify" },
  );
  d.moveDown(1.4);
  kv(d, "Doktor Merujuk / Referring Doctor", "DR. LIM WEI JIE (MMC 34521)");
  d.moveDown(0.8);
  d.fontSize(9).fillColor("#555555").font("Helvetica")
    .text("Ini adalah surat rujukan rasmi klinik. / This is an official clinic referral letter.", PAGE.margin);
};

/* ---------------------------------------------------------------- Lab report */
const labReport = (P) => (d) => {
  header(d, [
    ["MAKMAL PATOLOGI HOSPITAL KUALA LUMPUR", 12],
    ["LAPORAN MAKMAL / LABORATORY REPORT", 10, "#333333", "Helvetica"],
  ]);
  kv(d, "Nama Pesakit / Patient Name", P.name);
  kv(d, P.foreign ? "No. Pasport / Passport No." : "No. K/P / IC No.", P.id);
  kv(d, "Tarikh Lahir / Date of Birth", P.dobDash);
  kv(d, "Jantina / Sex", P.jantina);
  kv(d, "No. Rujukan Makmal / Lab Ref No.", `LAB${P.digits.slice(0, 8)}`);
  kv(d, "Tarikh Sampel / Sample Date", "20 Julai 2026");
  sectionTitle(d, "FULL BLOOD COUNT (FBC)");

  const row = (test, result, unit, range, bold = false) => {
    const y = d.y;
    const f = bold ? "Helvetica-Bold" : "Helvetica";
    d.fontSize(8.5).fillColor("#111111").font(f).text(test, PAGE.margin, y, { width: 200 });
    d.text(result, 260, y, { width: 70, align: "right" });
    d.text(unit, 340, y, { width: 60, align: "right" });
    d.text(range, 410, y, { width: 135, align: "right" });
    d.moveDown(0.4);
  };
  row("Ujian / Test", "Keputusan", "Unit", "Julat Rujukan / Range", true);
  hr(d, "#999999", 0.6);
  row("Hemoglobin (Hb)", "13.5", "g/dL", "13.0 - 17.0");
  row("Sel Darah Putih (WBC)", "7.2", "x10^9/L", "4.0 - 11.0");
  row("Platelet", "250", "x10^9/L", "150 - 400");
  row("Hematokrit (HCT)", "40", "%", "40 - 52");
  d.moveDown(0.6);
  d.fontSize(8.5).fillColor("#555555").font("Helvetica")
    .text("Semua keputusan dalam julat normal. / All results within normal range.", PAGE.margin);
  d.moveDown(0.8);
  kv(d, "Disahkan Oleh / Verified By", "DR. TAN MEI LING (MMC 45678)");
  kv(d, "Tarikh Laporan / Report Date", "21 Julai 2026");
};

/* ------------------------------------------------------------ Insurance card */

/** Card issuers by the hospital's payer id: the names the eligibility check's alias table recognises. */
const CARD_PAYERS = {
  aia: { name: "AIA BHD.", prefix: "AIA", hotline: "1300 88 1899" },
  greateastern: { name: "GREAT EASTERN LIFE ASSURANCE (MALAYSIA) BERHAD", prefix: "GE", hotline: "1300 1300 88" },
  allianz: { name: "ALLIANZ LIFE INSURANCE MALAYSIA BERHAD", prefix: "AZ", hotline: "1300 22 5542" },
  prudential: { name: "PRUDENTIAL BSN TAKAFUL BERHAD", prefix: "PB", hotline: "1300 88 1189" },
};
const FALLBACK_PAYERS = ["aia", "greateastern", "allianz"];

/** "2027-05-31" or a Date as "05/27". */
const validThru = (when) => {
  const date = typeof when === "string" ? new Date(`${when}T00:00:00`) : when;
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getFullYear()).slice(2)}`;
};

const insuranceCard = (P) => (d) => {
  // The policy on the hospital's record when the server passes it, so the card and the record agree.
  const payer = CARD_PAYERS[P.policy?.payer] ?? CARD_PAYERS[FALLBACK_PAYERS[P.key % FALLBACK_PAYERS.length]];
  const twoYears = new Date();
  twoYears.setFullYear(twoYears.getFullYear() + 2);

  header(d, [
    ["SALINAN KAD PERUBATAN (DEPAN & BELAKANG)", 13],
    ["MEDICAL CARD COPY — FRONT & BACK", 9.5, "#333333", "Helvetica"],
  ]);

  const cardW = 340;
  const cardH = 214;
  const cardX = (PAGE.w - cardW) / 2;
  const left = cardX + 16;
  const field = (label, value, y) => {
    d.fontSize(8).fillColor("#54607a").font("Helvetica").text(label, left, y);
    d.fontSize(9.5).fillColor("#111111").font("Helvetica-Bold").text(value, left + 80, y - 1);
  };

  let y = d.y + 6;
  d.roundedRect(cardX, y, cardW, cardH, 12).lineWidth(1).strokeColor("#8aa0c8").stroke();
  d.roundedRect(cardX, y, cardW, 44, 12).fillColor("#e3ecf7").fill();
  d.fontSize(9.5).fillColor("#0a1f44").font("Helvetica-Bold").text(payer.name, left, y + 9, { width: cardW - 32 });
  d.fontSize(7.5).fillColor("#54607a").font("Helvetica").text("MEDICAL CARD / KAD PERUBATAN", left, y + 27);
  d.fontSize(12).fillColor("#111111").font("Helvetica-Bold").text(P.name, left, y + 62, { width: cardW - 32 });
  field(P.foreign ? "Passport" : "NRIC", P.id, y + 96);
  field("Member ID", P.policy?.memberId ?? `${payer.prefix}${P.digits.slice(2, 10)}`, y + 120);
  field("Policy No.", P.policy?.policyNumber ?? `P${P.digits.slice(0, 8)}`, y + 144);
  field("Valid Thru", validThru(P.policy?.expiry ?? twoYears), y + 168);

  y += cardH + 22;
  d.roundedRect(cardX, y, cardW, cardH * 0.62, 12).lineWidth(1).strokeColor("#8aa0c8").stroke();
  d.fontSize(8).fillColor("#54607a").font("Helvetica").text("BELAKANG / BACK", left, y + 12);
  d.fontSize(8).fillColor("#333333").font("Helvetica")
    .text("Present this card at any panel hospital for admission.", left, y + 34, { width: cardW - 32 });
  d.text(`Guarantee Letter hotline: ${payer.hotline} (24 hours)`, left, y + 54, { width: cardW - 32 });
  d.text(`This card remains the property of ${payer.name}`, left, y + 74, { width: cardW - 32 });
};

/* ------------------------------------------------------------- Passport copy */

const MRZ_FILLER = "<";
const mrzField = (text, length) =>
  text.toUpperCase().replace(/[^A-Z0-9]+/g, MRZ_FILLER).padEnd(length, MRZ_FILLER).slice(0, length);

/** ICAO 9303 check digit: weights 7-3-1 over digits, letters (A=10) and fillers (0). */
function mrzCheck(text) {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const value = ch === MRZ_FILLER ? 0 : /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 55;
    sum += value * weights[i % 3];
  }
  return String(sum % 10);
}

const MONTHS_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const passportCopy = (P) => (d) => {
  const [given, ...rest] = P.name.split(" ");
  const surname = rest.join(" ") || given;
  const yymmdd = (date) =>
    `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const born = new Date(P.dob.year, P.dob.month, P.dob.day);
  const issued = new Date(SEED_AGE_YEAR - 3, P.key % 12, 1 + (P.key % 27));
  const expires = new Date(issued.getFullYear() + 10, issued.getMonth(), issued.getDate() - 1);
  const english = (date) => `${String(date.getDate()).padStart(2, "0")} ${MONTHS_EN[date.getMonth()]} ${date.getFullYear()}`;
  const sex = P.female ? "F" : "M";

  header(d, [
    ["PASSPORT COPY — PERSONAL DATA PAGE", 13],
    ["SALINAN PASPORT — HALAMAN MAKLUMAT PERIBADI", 9.5, "#333333", "Helvetica"],
  ]);

  const pageW = 440;
  const pageH = 300;
  const x = (PAGE.w - pageW) / 2;
  let y = d.y + 8;
  d.roundedRect(x, y, pageW, pageH, 10).lineWidth(1).strokeColor("#8aa0c8").stroke();
  d.fontSize(10).fillColor("#0a1f44").font("Helvetica-Bold").text(`${P.country.toUpperCase()} · PASSPORT`, x + 16, y + 12);
  d.fontSize(7.5).fillColor("#54607a").font("Helvetica").text("Type / Loai  P", x + pageW - 170, y + 14);
  d.text(`Code / Ma so  ${P.countryCode}`, x + pageW - 100, y + 14);
  d.rect(x + 16, y + 40, 96, 120).lineWidth(0.8).strokeColor("#9aa5b8").stroke();
  d.fontSize(6.5).fillColor("#9aa5b8").text("PHOTO", x + 50, y + 96);

  const fx = x + 128;
  const field = (label, value, fy) => {
    d.fontSize(7).fillColor("#54607a").font("Helvetica").text(label, fx, fy);
    d.fontSize(10).fillColor("#111111").font("Helvetica-Bold").text(value, fx, fy + 9, { width: pageW - 150 });
  };
  field("Passport No. / So ho chieu", P.id, y + 40);
  field("Surname / Ho", surname.toUpperCase(), y + 66);
  field("Given names / Chu dem va ten", given.toUpperCase(), y + 92);
  field("Nationality / Quoc tich", P.nationality, y + 118);
  field("Date of birth / Ngay sinh", english(born), y + 144);
  d.fontSize(7).fillColor("#54607a").font("Helvetica").text("Sex / Gioi tinh", fx + 170, y + 144);
  d.fontSize(10).fillColor("#111111").font("Helvetica-Bold").text(sex, fx + 170, y + 153);
  field("Date of issue / Ngay cap", english(issued), y + 170);
  d.fontSize(7).fillColor("#54607a").font("Helvetica").text("Date of expiry / Co gia tri den", fx + 170, y + 170);
  d.fontSize(10).fillColor("#111111").font("Helvetica-Bold").text(english(expires), fx + 170, y + 179);

  // A number longer than nine characters overflows into the optional data, its check digit after it (ICAO 9303-4).
  const id = mrzField(P.id, P.id.length);
  const long = id.length > 9;
  const head = id.slice(0, 9).padEnd(9, MRZ_FILLER);
  const number = head + (long ? MRZ_FILLER : mrzCheck(head));
  const optional = mrzField(long ? id.slice(9) + mrzCheck(id) : "", 14);
  const name = (text) => text.toUpperCase().replace(/[^A-Z]+/g, MRZ_FILLER);
  const line1 = `P<${P.countryCode}${name(surname)}<<${name(given)}`.padEnd(44, MRZ_FILLER).slice(0, 44);
  const body =
    number + P.countryCode + yymmdd(born) + mrzCheck(yymmdd(born)) + sex +
    yymmdd(expires) + mrzCheck(yymmdd(expires)) + optional + mrzCheck(optional);
  const line2 = body + mrzCheck(body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43));
  d.rect(x, y + pageH - 62, pageW, 62).fillColor("#f2f4f8").fill();
  d.fontSize(11).fillColor("#111111").font("Courier-Bold")
    .text(line1, x + 14, y + pageH - 50, { characterSpacing: 0.4 })
    .text(line2, x + 14, y + pageH - 30, { characterSpacing: 0.4 });

  d.fontSize(9).fillColor("#555555").font("Helvetica")
    .text('Catatan: "SALINAN — UNTUK URUSAN RASMI SAHAJA"', PAGE.margin, y + pageH + 24);
};

/* ------------------------------------------------------------ Imaging report */
const imagingReport = (P) => (d) => {
  header(d, [
    ["JABATAN RADIOLOGI HOSPITAL KUALA LUMPUR", 12],
    ["LAPORAN RADIOLOGI / RADIOLOGY REPORT", 10, "#333333", "Helvetica"],
  ]);
  kv(d, "Nama Pesakit / Patient Name", P.name);
  kv(d, P.foreign ? "No. Pasport / Passport No." : "No. K/P / IC No.", P.id);
  kv(d, "Tarikh Lahir / Date of Birth", P.dobDash);
  kv(d, "Jantina / Sex", P.jantina);
  kv(d, "No. Rujukan / Accession No.", `RAD${P.digits.slice(1, 9)}`);
  kv(d, "Pemeriksaan / Examination", "X-RAY RIGHT KNEE (AP & LATERAL)");
  kv(d, "Tarikh Pemeriksaan / Exam Date", malayDate(daysAgo(9)));
  sectionTitle(d, "FINDINGS");
  d.fontSize(10).fillColor("#111111").font("Helvetica").text(
    "Mild narrowing of the medial joint space of the right knee. Small marginal osteophytes at the " +
      "medial tibial plateau. No fracture or dislocation. No joint effusion. Soft tissues are unremarkable.",
    PAGE.margin,
    undefined,
    { width: RIGHT - PAGE.margin, lineGap: 4 },
  );
  sectionTitle(d, "IMPRESSION");
  d.fontSize(10).fillColor("#111111").font("Helvetica").text(
    "Early degenerative (osteoarthritic) changes of the right knee, medial compartment.",
    PAGE.margin,
    undefined,
    { width: RIGHT - PAGE.margin, lineGap: 4 },
  );
  d.moveDown(1.2);
  kv(d, "Pakar Radiologi / Radiologist", "DR. NURUL AIN ISMAIL (MMC 51234)");
};

/* --------------------------------------------------------- Discharge summary */
const dischargeSummary = (P) => (d) => {
  header(d, [
    ["HOSPITAL KUALA LUMPUR", 12],
    ["RINGKASAN DISCAJ / DISCHARGE SUMMARY", 10, "#333333", "Helvetica"],
  ]);
  kv(d, "Nama Pesakit / Patient Name", P.name);
  kv(d, P.foreign ? "No. Pasport / Passport No." : "No. K/P / IC No.", P.id);
  kv(d, "Tarikh Lahir / Date of Birth", P.dobDash);
  kv(d, "Wad / Ward", "Wad 6B (Perubatan Am / General Medicine)");
  kv(d, "Tarikh Masuk / Date of Admission", malayDate(daysAgo(40)));
  kv(d, "Tarikh Discaj / Date of Discharge", malayDate(daysAgo(36)));
  sectionTitle(d, "PRINCIPAL DIAGNOSIS");
  d.fontSize(10).fillColor("#111111").font("Helvetica").text("Community-acquired pneumonia, right lower lobe.", PAGE.margin);
  sectionTitle(d, "HOSPITAL COURSE");
  d.fontSize(10).fillColor("#111111").font("Helvetica").text(
    "Admitted with fever and productive cough for 4 days. Treated with intravenous antibiotics, " +
      "converted to oral on day 3. Afebrile for 48 hours before discharge, tolerating diet.",
    PAGE.margin,
    undefined,
    { width: RIGHT - PAGE.margin, lineGap: 4 },
  );
  sectionTitle(d, "DISCHARGE MEDICATION");
  d.fontSize(10).fillColor("#111111").font("Helvetica")
    .text("Amoxicillin-clavulanate 625 mg, 1 tablet twice daily for 5 days", PAGE.margin)
    .text("Paracetamol 1 g, as needed for fever, up to 4 times a day", PAGE.margin);
  sectionTitle(d, "FOLLOW-UP");
  d.fontSize(10).fillColor("#111111").font("Helvetica")
    .text("Medical clinic in 2 weeks with a repeat chest X-ray.", PAGE.margin);
  d.moveDown(1);
  kv(d, "Doktor / Doctor", "DR. ARJUN PILLAI (MMC 47890)");
};

/* ------------------------------------------------------------- Patient card */

const patientCard = (P) => {
  const build = (d, images) => {
    header(d, [
      ["HOSPITAL CONCIERGE · PATIENT CARD", 13],
      ["KAD PESAKIT — PRINT AND CUT OUT, OR SCAN FROM THE SCREEN", 9, "#333333", "Helvetica"],
    ]);
    const cardW = 340;
    const cardH = 214;
    const x = (PAGE.w - cardW) / 2;
    const y = d.y + 10;
    d.roundedRect(x, y, cardW, cardH, 14).lineWidth(1).strokeColor("#8aa0c8").stroke();
    d.roundedRect(x, y, cardW, 40, 14).fillColor("#0f4c81").fill();
    d.fontSize(11).fillColor("#ffffff").font("Helvetica-Bold").text("Hospital Concierge", x + 16, y + 14);
    d.fontSize(7.5).text("PATIENT CARD", x + cardW - 90, y + 16);
    d.fontSize(7).fillColor("#54607a").font("Helvetica").text("NAME", x + 16, y + 52);
    d.fontSize(13).fillColor("#111111").font("Helvetica-Bold").text(P.name, x + 16, y + 62, { width: cardW - 32 });
    d.fontSize(7).fillColor("#54607a").font("Helvetica").text("MRN", x + 16, y + 84);
    d.fontSize(13).fillColor("#111111").font("Helvetica-Bold").text(displayMrn(P.mrn), x + 16, y + 94);
    d.image(images.barcode, x + 20, y + 124, { width: cardW - 40, height: 64 });
    d.fontSize(8).fillColor("#555555").font("Helvetica")
      .text("Scan this card at any kiosk instead of your MyKad or passport.", x, y + cardH + 14, { width: cardW, align: "center" });
  };
  build.images = async () => ({
    barcode: await barcodePng({ bcid: "code128", text: P.mrn, scale: 3, height: 14, paddingwidth: 6, paddingheight: 2, backgroundcolor: "FFFFFF" }),
  });
  return build;
};

/** "MRN 1234567-4", as src/hospital/patient-id.ts prints it. */
const displayMrn = (mrn) => {
  const digits = mrn.replace(/\D/g, "");
  return digits.length === 8 ? `MRN ${digits.slice(0, 7)}-${digits.slice(7)}` : mrn;
};

/* ---------------------------------------------------------- Appointment slip */

const appointmentSlip = (P) => {
  const slip = P.slip;
  const build = (d, images) => {
    header(d, [
      ["HOSPITAL CONCIERGE · APPOINTMENT SLIP", 13],
      ["SLIP TEMUJANJI — SCAN THE BARCODE AT ANY KIOSK ON THE DAY", 9, "#333333", "Helvetica"],
    ]);
    kv(d, "Patient", P.name);
    if (P.mrn) kv(d, "MRN", displayMrn(P.mrn));
    kv(d, "Date", slip.date);
    kv(d, "Time", slip.time);
    kv(d, "Clinic", slip.clinic);
    kv(d, "Doctor", slip.doctor);
    if (slip.place) kv(d, "Where", slip.place);
    kv(d, "Reference", slip.reference);
    // The signed code is 20 digits, longer than the card's MRN, so its barcode takes the full width.
    const top = d.y + 16;
    d.image(images.barcode, PAGE.margin, top, { width: RIGHT - PAGE.margin, height: 64 });
    d.fontSize(9).fillColor("#555555").font("Helvetica").text(
      "On the day, hold this slip — or a photo of it on your phone — under the kiosk scanner to check in. " +
        "It only works with your date of birth.",
      PAGE.margin,
      top + 64 + 20,
      { width: RIGHT - PAGE.margin },
    );
  };
  build.images = async () => ({
    barcode: await barcodePng({ bcid: "code128", text: slip.code, scale: 3, height: 14, paddingwidth: 6, paddingheight: 2, backgroundcolor: "FFFFFF" }),
  });
  return build;
};

/* ----------------------------------------------------------------- doc table */

/**
 * role: which kind of paperwork the document stands in for at a scan step
 * (see src/app/api/_lib/mock-documents.ts). tamper: the false variants that
 * show on this document; the default is both, and a document whose checks
 * only compare the name ("holder" alone) would let an altered ID through.
 * when: the document exists for this person. genuine: a code to scan, never
 * tampered — the kiosk reads the code, not the printing around it.
 */
const DOCS = [
  {
    file: "mykad-copy.pdf",
    role: "identity",
    label: "MyKad copy",
    when: (P) => !P.foreign,
    title: (P) => `Salinan MyKad - ${P.name}`,
    build: mykadCopy,
  },
  {
    file: "passport-copy.pdf",
    role: "identity",
    label: "Passport copy",
    when: (P) => P.foreign,
    title: (P) => `Passport - ${P.name}`,
    build: passportCopy,
  },
  {
    file: "referral-letter.pdf",
    role: "referral",
    label: "Referral letter",
    tamper: ["holder"],
    title: (P) => `Surat Rujukan Perubatan - ${P.name}`,
    build: referralLetter,
  },
  {
    file: "lab-report.pdf",
    role: "medical",
    label: "Lab report (FBC)",
    tamper: ["holder"],
    title: (P) => `Laporan Makmal (FBC) - ${P.name}`,
    build: labReport,
  },
  {
    file: "insurance-card.pdf",
    role: "insurance-card",
    label: "Insurance card copy",
    title: (P) => `Salinan Kad Perubatan - ${P.name}`,
    build: insuranceCard,
  },
  {
    file: "imaging-report.pdf",
    role: "medical",
    label: "Imaging report (knee X-ray)",
    tamper: ["holder"],
    title: (P) => `Laporan Radiologi - ${P.name}`,
    build: imagingReport,
  },
  {
    file: "discharge-summary.pdf",
    role: "medical",
    label: "Discharge summary",
    tamper: ["holder"],
    title: (P) => `Ringkasan Discaj - ${P.name}`,
    build: dischargeSummary,
  },
  {
    file: "patient-card.pdf",
    role: "code",
    label: "Patient card (MRN barcode)",
    genuine: true,
    when: (P) => Boolean(P.mrn),
    title: (P) => `Patient card - ${P.name}`,
    build: patientCard,
  },
  {
    file: "appointment-slip.pdf",
    role: "code",
    label: "Appointment slip (barcode)",
    genuine: true,
    when: (P) => Boolean(P.slip),
    title: (P) => `Appointment slip - ${P.name}`,
    build: appointmentSlip,
  },
];

/** One person's documents, each with who it really shows: the person when donor is null, else a tampered variant. */
function plan(P, donor) {
  return DOCS.filter((doc) => (doc.when ? doc.when(P) : true) && !(donor && doc.genuine)).map((doc, i) => {
    const entry = { file: doc.file, role: doc.role };
    if (!donor) return { doc, shown: P, entry: { ...entry, valid: true } };
    const modes = doc.tamper ?? ["holder", "id"];
    const mode = modes[(i + P.key) % modes.length];
    const { person: T, note } = tamper(P, donor, mode);
    return { doc, shown: T, entry: { ...entry, valid: false, mode, note } };
  });
}

/** The file standing in for a role ("identity", "referral", "medical", "insurance-card") for this person. */
export const fileForRole = (P, role) =>
  DOCS.find((doc) => doc.role === role && (doc.when ? doc.when(P) : true))?.file ?? null;

/** What each document of the set is, without rendering it. */
export const describeSet = (P, donor) =>
  plan(P, donor).map(({ doc, shown, entry }) => ({ ...entry, label: doc.label, title: doc.title(shown) }));

/** The set's PDFs (or just `only`, a file name), in DOCS order. */
export async function renderSet(P, donor, only) {
  const out = [];
  for (const { doc, shown, entry } of plan(P, donor)) {
    if (only && entry.file !== only) continue;
    out.push({ ...entry, bytes: await render(doc.title(shown), entry.note ?? null, doc.build(shown)) });
  }
  return out;
}

/** The manifest.json written beside a set. */
export const manifestOf = (P, donor) => ({
  citizenKey: P.key,
  citizenId: P.id,
  name: P.name,
  variant: donor ? "false" : "good",
  files: plan(P, donor).map(({ entry }) => entry),
});
