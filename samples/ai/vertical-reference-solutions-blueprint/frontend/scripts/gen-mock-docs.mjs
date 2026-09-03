// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Generates the Malaysian mock documents in ../assets/mocks used by the
 * mock scanner (src/app/api/_lib/scanner.ts). Layouts follow the real
 * documents (field order, bilingual labels, reference-number formats) so
 * they behave like real scans in the OCR + LLM pipeline. All data is
 * fictional (drawn from data/citizens.csv or the local registry DB), and each
 * PDF's Subject metadata marks it as a test fixture (metadata is invisible to
 * OCR, so it can't skew the analysis).
 *
 * Usage:
 *   npm run mocks:gen                          # citizen 1 only
 *   node scripts/gen-mock-docs.mjs --citizens 1,4,7
 *   node scripts/gen-mock-docs.mjs --citizens MY3080592042
 *   node scripts/gen-mock-docs.mjs --all
 *
 * Every document lands in a per-person folder, split by validity:
 *   assets/mocks/citizens/<key>-<name>/good/   documents matching the registry
 *   assets/mocks/citizens/<key>-<name>/false/  tampered documents (another
 *     person's identity, altered ID digits, or someone else's address) plus a
 *     manifest.json describing what is wrong with each file
 * All folders use the same filenames, so any of them works as a drop-in
 * mocks dir: e.g. KIOSK_READER_CITIZEN=4 with
 * KIOSK_SCANNER_MOCKS=../assets/mocks/citizens/4-hao-rahman/false
 * demos the LLM mismatch warning; point at .../good to demo a clean pass.
 */
import PDFDocument from "pdfkit";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../../assets/mocks");
const CSV = path.resolve(HERE, "../data/citizens.csv");

/** Characters a mock-document path may consist of. */
const PATH_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._/";

/** Joined path, refused when a segment (e.g. "../..") would escape OUT. */
function insideOut(...segments) {
  const target = path.resolve(path.join(...segments));
  if (target !== OUT && !target.startsWith(OUT + path.sep)) {
    throw new Error(`refusing to write outside ${OUT}: ${target}`);
  }
  return target;
}

/* ------------------------------------------------------------- registry rows */

function loadCitizens() {
  const [head, ...rows] = readFileSync(CSV, "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  return rows.map((row) => {
    const cells = row.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
  });
}

/** Load an enrolled citizen who is not part of the initial CSV seed data. */
function loadPayloadCitizen(token) {
  const databaseUrl = process.env.DATABASE_URL ?? "file:./db.sqlite";
  if (!databaseUrl.startsWith("file:")) return null;

  const databasePath = path.resolve(process.cwd(), databaseUrl.slice("file:".length));
  if (!existsSync(databasePath)) return null;

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database
      .prepare(
        `SELECT citizen_key, citizen_id, name, country, age, phone, email,
                address_line, address_city, address_postcode
         FROM citizens
         WHERE citizen_key = ? OR UPPER(citizen_id) = ?
         LIMIT 1`,
      )
      .get(Number(token), token.toUpperCase());
    if (!row) return null;

    return person({
      CitizenKey: row.citizen_key,
      SyntheticCitizenID: row.citizen_id,
      SyntheticName: row.name,
      Country: row.country,
      Age: row.age,
      Phone: row.phone,
      Email: row.email,
      AddressLine: row.address_line,
      City: row.address_city,
      Postcode: row.address_postcode,
    });
  } finally {
    database.close();
  }
}

/* First names in data/citizens.csv, for the gender fields printed on docs. */
const FEMALE = new Set(["AINA", "ANH", "FARAH", "JIA", "LINH", "NADIA", "NGA", "NUR", "SITI", "TRANG"]);

const MONTHS_MS = ["JAN", "FEB", "MAC", "APR", "MEI", "JUN", "JUL", "OGO", "SEP", "OKT", "NOV", "DIS"];
const MONTHS_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

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

/**
 * Person model for the document builders, derived from a citizens.csv row.
 * The date of birth uses the same formula as src/app/api/_lib/citizens.ts
 * (day/month from CitizenKey, year from age), and the printed ID number is
 * the registry citizenId, so the LLM's holder cross-check (name, national ID,
 * address) genuinely passes on a "true" document.
 */
function person(row) {
  const key = Number(row.CitizenKey);
  const age = Number(row.Age) || 30;
  const name = row.SyntheticName.toUpperCase();
  const id = row.SyntheticCitizenID.toUpperCase();
  const digits = id.replace(/\D/g, "").padEnd(10, "0");
  const month = key % 12;
  const day = 1 + ((key * 13) % 28);
  const year = new Date().getFullYear() - age;
  const dd = String(day).padStart(2, "0");
  const mm = String(month + 1).padStart(2, "0");
  const female = FEMALE.has(row.SyntheticName.split(" ")[0].toUpperCase());
  const malaysian = row.Country === "Malaysia";
  return {
    key,
    age,
    name,
    id,
    icCompact: digits,
    digits,
    female,
    jantina: female ? "PEREMPUAN" : "LELAKI",
    sexPair: female ? "P / F" : "L / M",
    sexLetter: female ? "F" : "M",
    dobSlash: `${dd}/${mm}/${year}`,
    dobDash: `${dd}-${mm}-${year}`,
    dobLong: `${dd} ${MONTHS_MS[month]} ${year}`,
    dobDual: `${dd} ${MONTHS_MS[month]} / ${MONTHS_EN[month]} ${year}`,
    dobMrz: `${String(year % 100).padStart(2, "0")}${mm}${dd}`,
    city: row.City.toUpperCase(),
    address: `${row.AddressLine}, ${row.Postcode} ${row.City}, ${row.Country}`.toUpperCase(),
    // The home the citizen has just moved into, printed on the proof-of-
    // address document only. A bill showing the address the registry already
    // holds is not proof of a new one — the kiosk refuses it — so the
    // stand-in for an address change has to show somewhere else. Derived from
    // the key so each citizen's new home is their own.
    newAddress: `NO. ${20 + key}, JALAN SERI MURNI ${1 + (key % 9)}, TAMAN SERI MURNI, ${
      String(41150 + key * 7).slice(0, 5)
    } SHAH ALAM, SELANGOR`,
    phone: row.Phone,
    country: row.Country.toUpperCase(),
    countryCode: malaysian ? "MYS" : "VNM",
    slug: `${key}-${slugOf(row.SyntheticName)}`,
  };
}

/**
 * Tampered variant of a person for the "false" documents. The donor is a
 * different registry citizen; every mode plants at least one printed detail
 * that belongs to someone else, which the LLM verification must reject.
 *
 * There is no address mode: the kiosk does not check a printed address
 * against the registry (see DocumentRequirement.holderDetails), so an
 * address-swapped document would pass and read as a check that failed to
 * catch it. Who a document belongs to is settled by the name and the IC
 * number, and those are what the false set tampers with.
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

function makeDoc(dir, file, title, tampered, build) {
  // Rebuilt inline, character by character off the allowlist: the security
  // scan only trusts sanitization done in the same function as the write.
  let target = "";
  for (const ch of insideOut(dir, file)) {
    let ok = "";
    for (const allowed of PATH_CHARS) {
      if (allowed === ch) {
        ok = allowed;
        break;
      }
    }
    if (!ok) throw new Error("mock document path contains a forbidden character");
    target += ok;
  }
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
    const stream = createWriteStream(target);
    d.pipe(stream);

    build(d);

    d.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
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

/* Monospace key/value for computer printouts (police report, KPP slip). */
const mono = (d, text, opts = {}) => {
  d.fontSize(opts.size ?? 9.5)
    .fillColor(opts.color ?? "#111111")
    .font(opts.bold ? "Courier-Bold" : "Courier")
    .text(text, PAGE.margin, undefined, { width: RIGHT - PAGE.margin, lineGap: 1.5, ...opts.text });
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
  // ID number
  d.fontSize(15).fillColor("#111111").font("Helvetica-Bold").text(P.id, cardX + 62, y + 46);
  // Name + address
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

/* -------------------------------------------------------------- Police report */
const policeReport = (P) => (d) => {
  header(d, [
    ["POLIS DIRAJA MALAYSIA", 14],
    ["REPOT POLIS / POLICE REPORT", 10.5, "#333333", "Helvetica"],
  ]);
  mono(d, "Balai      : TAMAN MELAWATI");
  mono(d, "Daerah     : WANGSA MAJU");
  mono(d, "Kontinjen  : KUALA LUMPUR");
  d.moveDown(0.4);
  mono(d, "No. Repot      : TAMAN MELAWATI/003412/26", { bold: true });
  mono(d, "Tarikh Repot   : 20/07/2026          Masa Repot    : 1042");
  mono(d, "Tarikh Kejadian: 19/07/2026          Masa Kejadian : 1500 - 1800");
  mono(d, "Tempat Kejadian: PUSAT BELI-BELAH, TAMAN MELAWATI, KUALA LUMPUR");
  mono(d, "Bahasa Diterima: BAHASA MALAYSIA");
  d.moveDown(0.6);

  mono(d, "BUTIR-BUTIR PENGADU", { bold: true });
  mono(d, `Nama        : ${P.name}`);
  mono(d, `No. K/P     : ${P.id}`);
  mono(d, `Jantina     : ${P.jantina.padEnd(17)}Tarikh Lahir : ${P.dobSlash}   Umur : ${P.age}`);
  mono(d, "Bangsa      : MELAYU            Warganegara  : WARGANEGARA MALAYSIA");
  mono(d, "Pekerjaan   : PEMBANTU OPERASI");
  mono(d, `Alamat      : ${P.address}`);
  mono(d, `No. Telefon : ${P.phone}`);
  d.moveDown(0.6);

  mono(d, "REPOT:", { bold: true });
  mono(
    d,
    "SAYA SEPERTI BUTIR-BUTIR DI ATAS INGIN MEMBUAT REPORT BAHAWA PADA " +
      "19/07/2026 LEBIH KURANG JAM 1500 HINGGA 1800, SAYA TELAH KEHILANGAN " +
      "LESEN MEMANDU KELAS D SEMASA MEMBELI-BELAH DI SEKITAR TAMAN MELAWATI, " +
      "KUALA LUMPUR. SAYA SEDAR KEHILANGAN TERSEBUT APABILA PULANG KE RUMAH. " +
      "REPORT INI DIBUAT UNTUK TUJUAN PERMOHONAN GANTIAN LESEN MEMANDU DI JPJ. " +
      "SEKIAN REPORT SAYA.",
  );
  d.moveDown(0.6);

  mono(d, "BUTIR-BUTIR PENERIMA REPOT", { bold: true });
  mono(d, "Pangkat : KOPERAL            Nama : MOHD FAIZAL BIN OSMAN");
  mono(d, "No.     : G/12345");
  d.moveDown(0.8);
  hr(d, "#999999", 0.8);
  mono(d, "INI ADALAH CETAKAN KOMPUTER. TIADA TANDATANGAN DIPERLUKAN.", {
    size: 8.5,
    color: "#555555",
  });
};

/* ---------------------------------------------------------- Birth certificate */
const birthCertificate = (P) => (d) => {
  // Green security-paper tint (citizen certificates are green).
  d.save();
  d.rect(PAGE.margin - 10, d.y - 6, RIGHT - PAGE.margin + 20, 560).fillColor("#eef7ee").fill();
  d.restore();
  d.fontSize(8.5).fillColor("#b00020").font("Helvetica-Bold")
    .text(`No. Bersiri / Serial No.: H ${P.digits.slice(0, 7)}`, PAGE.margin, d.y, { align: "right" });
  header(d, [
    ["KERAJAAN MALAYSIA / GOVERNMENT OF MALAYSIA", 11],
    ["JABATAN PENDAFTARAN NEGARA / NATIONAL REGISTRATION DEPARTMENT", 9.5, "#333333", "Helvetica"],
    ["SIJIL KELAHIRAN / BIRTH CERTIFICATE", 13],
    ["(Akta Pendaftaran Kelahiran dan Kematian 1957)", 8.5, "#555555", "Helvetica"],
  ]);
  kv(d, "No. Pendaftaran / Registration No.", `KL${P.digits.slice(0, 8)}`);
  kv(d, "Nama / Name", P.name);
  kv(d, "No. Kad Pengenalan / Identity Card No.", P.id);
  kv(d, "Jantina / Sex", P.jantina);
  kv(d, "Tarikh Lahir / Date of Birth", P.dobDash);
  kv(d, "Tempat Lahir / Place of Birth", `HOSPITAL ${P.city}`);
  d.moveDown(0.3);
  kv(d, "Nama Bapa / Name of Father", "AHMAD BIN HASSAN");
  kv(d, "No. Pengenalan / Identity No.", "600522-10-4321");
  kv(d, "Warganegara / Citizenship", "WARGANEGARA");
  kv(d, "Pekerjaan / Occupation", "PENIAGA");
  d.moveDown(0.3);
  kv(d, "Nama Ibu / Name of Mother", "SITI MARIAM BINTI ISMAIL");
  kv(d, "No. Pengenalan / Identity No.", "630711-08-6543");
  kv(d, "Warganegara / Citizenship", "WARGANEGARA");
  kv(d, "Pekerjaan / Occupation", "SURI RUMAH");
  d.moveDown(0.3);
  kv(d, "Taraf Kewarganegaraan / Citizenship Status", "WARGANEGARA");
  kv(d, "Tarikh Pendaftaran / Date of Registration", P.dobDash);
  kv(d, "Nama Pendaftar / Name of Registrar", "PENOLONG PENDAFTAR KELAHIRAN DAN KEMATIAN, KUALA LUMPUR");
  d.moveDown(1);
  d.fontSize(8.5).fillColor("#555555").font("Helvetica").text(
    "Diperakui bahawa ini adalah cabutan yang benar daripada Daftar Kelahiran. / " +
      "Certified to be a true extract from the Register of Births.",
    PAGE.margin,
  );
};

/* ------------------------------------------------------------- KPP01 slip */
const kppSlip = (P) => (d) => {
  header(d, [
    ["INSTITUT MEMANDU METRO SDN. BHD. (KOD PUSAT: B1234)", 11],
    ["KEPUTUSAN UJIAN KPP (BERKOMPUTER) / COMPUTERISED KPP TEST RESULT", 9.5, "#333333", "Helvetica"],
  ]);
  mono(d, `Nama          : ${P.name}`);
  mono(d, `No. K/P       : ${P.id}`);
  mono(d, "Pusat Ujian   : INSTITUT MEMANDU METRO, KUALA LUMPUR");
  mono(d, "Tarikh Ujian  : 02/07/2026        Masa : 1000");
  mono(d, "Kelas Dipohon : D");
  d.moveDown(0.5);
  mono(d, "------------------------------------------------------------");
  mono(d, "Bahagian A (Tanda & Isyarat Jalan Raya)        : 16 / 17");
  mono(d, "Bahagian B (Undang-undang & Peraturan)         : 15 / 16");
  mono(d, "Bahagian C (Sistem KEJARA & Keselamatan)       : 16 / 17");
  mono(d, "------------------------------------------------------------");
  mono(d, "JUMLAH MARKAH                                  : 47 / 50", { bold: true });
  mono(d, "KEPUTUSAN                                      : LULUS", { bold: true });
  mono(d, "(Markah lulus: 42/50)");
  mono(d, "------------------------------------------------------------");
  mono(d, `No. Siri/Resit : KPP26${P.digits.slice(0, 8)}`);
  mono(d, "Sah Untuk      : PERMOHONAN LESEN MEMANDU PELAJAR (LDL)");
  d.moveDown(0.8);
  d.fontSize(8.5).fillColor("#555555").font("Helvetica")
    .text("Sila bawa slip ini bersama MyKad semasa urusan di JPJ / institut memandu.", PAGE.margin);
};

/* -------------------------------------------------------- Surat akuan bujang */
const akuanBujang = (P) => (d) => {
  header(d, [
    ["AKUAN BERKANUN", 14],
    ["(Di bawah Akta Akuan Berkanun 1960 [Akta 783])", 9, "#555555", "Helvetica"],
    ["SURAT AKUAN TARAF BUJANG / SINGLE STATUS DECLARATION", 10, "#333333", "Helvetica"],
  ]);
  const body = (text) =>
    d.fontSize(10.5).fillColor("#111111").font("Helvetica")
      .text(text, PAGE.margin, undefined, { width: RIGHT - PAGE.margin, lineGap: 4, align: "justify" });

  body(
    `Saya, ${P.name} (No. Kad Pengenalan: ${P.id}), warganegara Malaysia ` +
      `yang beralamat di ${P.address}, dengan sesungguhnya dan sebenarnya mengaku bahawa:`,
  );
  d.moveDown(0.6);
  body("1.  Saya adalah seorang yang masih BUJANG dan belum pernah berkahwin di bawah mana-mana undang-undang, adat atau kepercayaan;");
  d.moveDown(0.3);
  body("2.  Saya membuat akuan ini bagi tujuan permohonan pendaftaran perkahwinan di Jabatan Pendaftaran Negara Malaysia.");
  d.moveDown(0.8);
  body(
    "Dan saya membuat akuan ini dengan kepercayaan bahawa apa-apa yang tersebut di dalamnya " +
      "adalah benar serta menurut Akta Akuan Berkanun 1960.",
  );
  d.moveDown(1.4);

  const y = d.y;
  d.fontSize(9.5).font("Helvetica").fillColor("#111111");
  d.text("Diperbuat dan diakui dengan sebenar-  )", PAGE.margin, y);
  d.text("benarnya oleh yang tersebut namanya    )", PAGE.margin);
  d.text(`di atas, iaitu ${P.name},`.padEnd(38) + " )", PAGE.margin);
  d.text("di KUALA LUMPUR dalam Wilayah          )", PAGE.margin);
  d.text("Persekutuan pada 18 JULAI 2026.        )", PAGE.margin);
  d.fontSize(9.5).text("..............................................", 340, y + 14);
  d.text("(Tandatangan Pembuat Akuan)", 350, y + 28);
  d.moveDown(2);
  d.text("Di hadapan saya,", PAGE.margin);
  d.moveDown(2);
  d.text("..............................................", PAGE.margin);
  d.text("PESURUHJAYA SUMPAH (No. Siri: W-999)", PAGE.margin);
  // Stamp box
  d.roundedRect(360, d.y - 34, 150, 60, 6).lineWidth(0.8).dash(3, { space: 2 }).strokeColor("#888888").stroke().undash();
  d.fontSize(7.5).fillColor("#888888").text("COP RASMI PESURUHJAYA SUMPAH", 372, d.y - 8, { width: 130, align: "center" });
};

/* ------------------------------------------------- Hospital birth confirmation */
const hospitalBirth = (P) => (d) => {
  header(d, [
    ["HOSPITAL KUALA LUMPUR", 13],
    ["KEMENTERIAN KESIHATAN MALAYSIA", 9.5, "#333333", "Helvetica"],
    ["PENGESAHAN KELAHIRAN / BIRTH CONFIRMATION", 11],
  ]);
  kv(d, "Nama Bayi / Name of Baby", "ADAM RAYYAN BIN MOHD FAIZ");
  kv(d, "Tarikh Lahir / Date of Birth", "02/07/2026");
  kv(d, "Masa Lahir / Time of Birth", "0418");
  kv(d, "Jantina / Sex", "LELAKI");
  kv(d, "Berat Lahir / Birth Weight", "3.24 KG");
  kv(d, "Jenis Kelahiran / Type of Birth", "TUNGGAL / SINGLE");
  kv(d, "Tempat Lahir / Place of Birth", "WAD BERSALIN, HOSPITAL KUALA LUMPUR");
  d.moveDown(0.3);
  if (P.female) {
    kv(d, "Nama Ibu / Mother's Name", P.name);
    kv(d, "No. K/P Ibu / Mother's IC", P.id);
  } else {
    kv(d, "Nama Bapa / Father's Name", P.name);
    kv(d, "No. K/P Bapa / Father's IC", P.id);
  }
  d.moveDown(0.3);
  kv(d, "Nama Doktor / Attending Doctor", "DR. TAN MEI LING");
  kv(d, "No. Pendaftaran MMC", "45678");
  kv(d, "Tarikh Dikeluarkan / Date Issued", "02/07/2026");
  d.moveDown(1.2);
  d.fontSize(9).fillColor("#555555").font("Helvetica").text(
    "Sila daftarkan kelahiran di mana-mana kaunter JPN dalam tempoh 60 hari dari tarikh " +
      "lahir (Borang NRD.LM01). Pendaftaran dalam tempoh adalah PERCUMA.",
    PAGE.margin,
  );
  d.moveDown(1.6);
  d.fontSize(9.5).fillColor("#111111")
    .text("..............................................", PAGE.margin);
  d.text("Tandatangan & Cop Rasmi Hospital");
};

/* --------------------------------------------------------- Passport bio page */
const MRZ_WEIGHTS = [7, 3, 1];
function mrzValue(ch) {
  if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48;
  if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 55;
  return 0; // '<'
}
function checkDigit(field) {
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += mrzValue(field[i]) * MRZ_WEIGHTS[i % 3];
  return String(sum % 10);
}
function padMrz(text, length) {
  return text.replace(/ /g, "<").padEnd(length, "<").slice(0, length);
}

const passportBio = (P) => (d) => {
  const passportNo = `A${P.digits.slice(0, 8)}`;
  const dob = P.dobMrz;
  const expiry = "330205";
  const personal = padMrz(P.icCompact, 14);
  const [surname, ...given] = P.name.split(" ").reverse();
  const line1 = padMrz(`P<${P.countryCode}${surname}<<${given.reverse().join("<")}`, 44);
  const composite =
    passportNo + checkDigit(passportNo) + dob + checkDigit(dob) + expiry + checkDigit(expiry) +
    personal + checkDigit(personal);
  const line2 =
    passportNo + checkDigit(passportNo) + P.countryCode + dob + checkDigit(dob) + P.sexLetter +
    expiry + checkDigit(expiry) + personal + checkDigit(personal) + checkDigit(composite);

  header(d, [
    [`PASPORT / PASSPORT — ${P.country}`, 13],
    ["SALINAN MUKA SURAT BIODATA / BIODATA PAGE COPY", 9.5, "#333333", "Helvetica"],
  ]);
  const y0 = d.y;
  // Photo placeholder
  d.rect(PAGE.margin, y0, 95, 120).lineWidth(0.8).strokeColor("#9aa5b8").stroke();
  d.fontSize(7).fillColor("#9aa5b8").text("FOTO / PHOTO", PAGE.margin + 22, y0 + 55);

  const fx = PAGE.margin + 115;
  const field = (label, value, dy) => {
    d.fontSize(7).fillColor("#54607a").font("Helvetica").text(label, fx, y0 + dy);
    d.fontSize(10).fillColor("#111111").font("Helvetica-Bold").text(value, fx, y0 + dy + 9);
  };
  field("Jenis / Type", "P", 0);
  field("Kod Negara / Country Code", P.countryCode, 26);
  field("No. Pasport / Passport No.", passportNo, 52);
  field("Nama / Name", P.name, 78);
  d.fontSize(7).fillColor("#54607a").font("Helvetica").text("Kewarganegaraan / Nationality", 380, y0);
  d.fontSize(10).fillColor("#111111").font("Helvetica-Bold")
    .text(`WARGANEGARA ${P.country}`, 380, y0 + 9, { width: 160 });
  d.fontSize(7).fillColor("#54607a").font("Helvetica").text("No. Pengenalan / Identity No.", 380, y0 + 36);
  d.fontSize(10).fillColor("#111111").font("Helvetica-Bold").text(P.id, 380, y0 + 45);

  d.y = y0 + 132;
  d.x = PAGE.margin;
  kv(d, "Tarikh Lahir / Date of Birth", P.dobDual);
  kv(d, "Tempat Lahir / Place of Birth", P.city);
  kv(d, "Jantina / Sex", P.sexPair);
  kv(d, "Tinggi / Height", "160 CM");
  kv(d, "Tarikh Dikeluarkan / Date of Issue", "05 FEB 2023");
  kv(d, "Tarikh Luput / Date of Expiry", "05 FEB 2033");
  kv(d, "Pejabat Pengeluar / Issuing Office", "JABATAN IMIGRESEN MALAYSIA, KUALA LUMPUR");

  // MRZ zone
  const yMrz = d.y + 18;
  d.rect(PAGE.margin, yMrz, RIGHT - PAGE.margin, 46).fillColor("#f4f6fa").fill();
  d.fontSize(11.5).fillColor("#111111").font("Courier-Bold");
  d.text(line1, PAGE.margin + 8, yMrz + 8);
  d.text(line2, PAGE.margin + 8, yMrz + 26);
};

/* --------------------------------------------- TNB bill & payslip & fallback */
const tnbBill = (P) => (d) => {
  const account = `2200${P.digits.slice(0, 8)}`;
  // Page 1 — "Bil Elektrik Anda" summary.
  const y0 = d.y;
  d.roundedRect(PAGE.margin, y0, 200, 26, 13).fillColor("#0a2a66").fill();
  d.fontSize(12).fillColor("#ffffff").font("Helvetica-Bold").text("Bil Elektrik Anda", PAGE.margin + 18, y0 + 7);
  d.fontSize(13).fillColor("#c8102e").font("Helvetica-BoldOblique").text("TENAGA NASIONAL", 380, y0 + 6, { width: 165, align: "right" });
  d.y = y0 + 40;

  const col = (x, lines) => {
    let y = d.y;
    for (const [label, value] of lines) {
      d.fontSize(6.5).fillColor("#0a2a66").font("Helvetica-Bold").text(label, x, y);
      d.fontSize(8.5).fillColor("#111111").font("Helvetica").text(value, x, y + 8, { width: 170 });
      y += 8 + 10 * Math.ceil(d.widthOfString(value) / 170) + 8;
    }
    return y;
  };
  const yInfo = d.y;
  const y1 = col(PAGE.margin, [["ALAMAT POS", `${P.name}\n${P.newAddress}`]]);
  d.y = yInfo;
  const y2 = col(240, [
    ["TARIKH BIL", "10.07.2026"],
    ["TEMPOH BIL", "10.06.2026 - 09.07.2026 (30 Hari)"],
    ["NO. INVOIS", "000123456789"],
    ["DEPOSIT SEKURITI", "RM0.00"],
  ]);
  d.y = yInfo;
  const y3 = col(415, [
    ["NO. AKAUN", account],
    ["JENIS BACAAN", "Bacaan Sebenar"],
    ["TARIF", "A : Domestik"],
    ["BAYARAN TERAKHIR", "RM72.40 (12.06.2026)"],
  ]);
  d.y = Math.max(y1, y2, y3) + 10;

  // Amount hero + summary cards
  const yHero = d.y;
  d.roundedRect(PAGE.margin, yHero, 220, 96, 10).fillColor("#0a2a66").fill();
  d.fontSize(8.5).fillColor("#bcd0f0").font("Helvetica").text("Jumlah Bil Anda (RM)", PAGE.margin + 16, yHero + 12);
  d.fontSize(30).fillColor("#ffffff").font("Helvetica-Bold").text("65.80", PAGE.margin + 16, yHero + 26);
  d.fontSize(8.5).fillColor("#bcd0f0").font("Helvetica").text("Sila bayar sebelum: 09 Ogo 2026", PAGE.margin + 16, yHero + 68);

  d.roundedRect(290, yHero, 255, 96, 10).fillColor("#e8f0fb").fill();
  d.fontSize(8.5).fillColor("#0a2a66").font("Helvetica-Bold").text("Ringkasan Bil Anda:", 302, yHero + 10);
  const card = (x, label, value) => {
    d.roundedRect(x, yHero + 26, 74, 54, 6).fillColor("#ffffff").fill();
    d.fontSize(6).fillColor("#54607a").font("Helvetica").text(label, x + 6, yHero + 32, { width: 62 });
    d.fontSize(10.5).fillColor("#111111").font("Helvetica-Bold").text(value, x + 6, yHero + 58);
  };
  card(302, "Baki Terdahulu (RM)", "0.00");
  card(384, "Caj Semasa (RM)", "65.79");
  card(466, "Pelarasan Penggenapan (RM)", "0.01");
  d.y = yHero + 110;

  // JomPAY + kiosk barcode strip
  const yPay = d.y;
  d.roundedRect(PAGE.margin, yPay, 130, 44, 6).lineWidth(1).strokeColor("#111111").stroke();
  d.fontSize(9).fillColor("#111111").font("Helvetica-Bold").text("JomPAY", PAGE.margin + 10, yPay + 7);
  d.fontSize(7).font("Helvetica").text("Biller Code : 5454", PAGE.margin + 10, yPay + 20);
  d.text(`Ref-1 : ${account}`, PAGE.margin + 10, yPay + 30);
  for (let i = 0; i < 60; i++) {
    const x = 200 + i * 2.6;
    if (i % 3 !== 1) d.rect(x, yPay + 6, i % 7 === 0 ? 1.8 : 0.9, 26).fillColor("#111111").fill();
  }
  d.fontSize(6.5).fillColor("#555555").font("Helvetica")
    .text(`${account} 000123456789 0000000000 006580`, 200, yPay + 36);
  d.fontSize(6.5).text("Sila imbas bagi pembayaran di Kios @Kedai Tenaga", 200, yPay + 46);
  d.y = yPay + 62;

  // 6-month usage chart
  sectionTitle(d, "Caj Elektrik Anda Bagi Tempoh 6 Bulan — Caj Bulanan (RM)");
  const months = [["FEB-26", 78.2], ["MAC-26", 71.4], ["APR-26", 84.9], ["MEI-26", 69.1], ["JUN-26", 72.4], ["JUL-26", 65.8]];
  const yChart = d.y;
  months.forEach(([m, v], i) => {
    const y = yChart + i * 15;
    d.fontSize(6.5).fillColor("#54607a").font("Helvetica").text(`${m} (BS)`, PAGE.margin, y + 2);
    d.rect(PAGE.margin + 55, y, v * 3.4, 9).fillColor(i === months.length - 1 ? "#0a2a66" : "#c3cfe3").fill();
    d.fontSize(6.5).fillColor("#111111").text(`RM${v.toFixed(2)}`, PAGE.margin + 60 + v * 3.4, y + 2);
  });
  d.y = yChart + months.length * 15 + 6;
  d.fontSize(6.5).fillColor("#888888").text("BS - Bacaan Sebenar, BA - Bacaan Anggaran", PAGE.margin);
  d.moveDown(1);
  d.fontSize(6.5).fillColor("#555555").text(
    "Tenaga Nasional Berhad 199001009294 (200866-W) · Nombor Pendaftaran ST W10-1808-31022372 · ms 1/2",
    PAGE.margin,
  );

  // Page 2 — "Bil Terperinci Anda": Anda Guna charge table + meter info.
  d.addPage();
  d.roundedRect(PAGE.margin, d.y, 200, 26, 13).fillColor("#0a2a66").fill();
  d.fontSize(12).fillColor("#ffffff").font("Helvetica-Bold").text("Bil Terperinci Anda", PAGE.margin + 18, d.y + 7);
  d.moveDown(2.4);
  d.x = PAGE.margin;
  kv(d, "NO. AKAUN", account);
  kv(d, "ALAMAT PREMIS", P.newAddress);
  kv(d, "TEMPOH BIL", "10.06.2026 - 09.07.2026 (30 Hari)");
  sectionTitle(d, "ANDA GUNA — TARIF DOMESTIK (mulai 1 Julai 2025)");
  const line = (label, kadar, unit, jumlah, bold = false) => {
    const y = d.y;
    const f = bold ? "Helvetica-Bold" : "Helvetica";
    d.fontSize(8.5).fillColor("#111111").font(f).text(label, PAGE.margin, y, { width: 230 });
    d.text(kadar, 290, y, { width: 90, align: "right" });
    d.text(unit, 385, y, { width: 55, align: "right" });
    d.text(jumlah, 450, y, { width: 95, align: "right" });
    d.moveDown(0.35);
  };
  line("", "Kadar", "kWj", "Jumlah (RM)", true);
  hr(d, "#999999", 0.6);
  line("Caj Penjanaan — Caj Tenaga", "27.03 sen/kWj", "300", "81.09");
  line("Caj Penjanaan — AFA (dikecualikan <= 600 kWj)", "0.00 sen/kWj", "300", "0.00");
  line("Caj Penjanaan — Caj Kapasiti", "4.55 sen/kWj", "300", "13.65");
  line("Caj Rangkaian", "12.85 sen/kWj", "300", "38.55");
  line("Caj Peruncitan (dikecualikan <= 600 kWj)", "RM10.00/bulan", "-", "0.00");
  hr(d, "#999999", 0.6);
  line("Jumlah Bil", "", "", "133.29", true);
  line("Insentif Cekap Tenaga", "-22.50 sen/kWj", "300", "-67.50");
  line("KWTBB (dikecualikan <= 300 kWj)", "1.60%", "", "0.00");
  line("Cukai Perkhidmatan (dikecualikan <= 600 kWj)", "8%", "", "0.00");
  hr(d, "#999999", 0.6);
  line("Jumlah Yang Perlu Dibayar (Caj Semasa)", "", "", "65.79", true);
  sectionTitle(d, "MAKLUMAT METER");
  line("No. Meter", "Dahulu", "Semasa", "Penggunaan (kWj)", true);
  line("M 7162013149", "45,300", "45,600", "300");
  d.moveDown(0.8);
  d.fontSize(7.5).fillColor("#555555").font("Helvetica").text(
    "Surcaj 1% dikenakan bagi pembayaran selepas 30 hari dari tarikh bil selaras dengan " +
      "Peraturan-Peraturan Bekalan Pemegang Lesen 1990. Bil ini boleh digunakan sebagai bukti " +
      "alamat untuk urusan rasmi (dalam tempoh 3 bulan). · ms 2/2",
    PAGE.margin,
    undefined,
    { width: RIGHT - PAGE.margin },
  );
};

const payslip = (P) => (d) => {
  header(d, [
    ["SYARIKAT MAJU JAYA SDN. BHD. (199801012345)", 12],
    ["NO. 8, JALAN PERDAGANGAN 2, 53100 KUALA LUMPUR", 8, "#555555", "Helvetica"],
    ["SLIP GAJI / PAY SLIP — BULAN: JULAI 2026 (01/07/2026 - 31/07/2026)", 9.5, "#333333", "Helvetica"],
  ]);
  const yInfo = d.y;
  const info = (x, rows) => {
    let y = yInfo;
    for (const [label, value] of rows) {
      d.fontSize(7.5).fillColor("#54607a").font("Helvetica").text(label, x, y, { width: 95 });
      d.fontSize(8.5).fillColor("#111111").font("Helvetica-Bold").text(value, x + 98, y, { width: 145 });
      y += 14 * Math.max(1, Math.ceil(d.widthOfString(value) / 145));
    }
    return y;
  };
  const ya = info(PAGE.margin, [
    ["Nama / Name", P.name],
    ["No. Pekerja / Emp No.", `EMP-${String(P.key).padStart(3, "0")}`],
    ["No. K/P / NRIC", P.id],
    ["Jawatan / Designation", "PEMBANTU OPERASI"],
  ]);
  const yb = info(310, [
    ["No. KWSP / EPF No.", "12345678"],
    ["No. PERKESO / SOCSO", P.id],
    ["No. Cukai / Tax No.", "SG 12345678090"],
    ["Bayaran / Payment", "MAYBANK ****1234"],
  ]);
  d.y = Math.max(ya, yb) + 8;
  hr(d, "#999999", 0.8);

  const yCols = d.y;
  const money = (d2, x, rows, title, total) => {
    d.fontSize(9).fillColor("#0a1f44").font("Helvetica-Bold").text(title, x, yCols);
    let y = yCols + 16;
    for (const [label, value] of rows) {
      d.fontSize(8.5).fillColor("#333333").font("Helvetica").text(label, x, y, { width: 155 });
      d.text(value, x + 155, y, { width: 70, align: "right" });
      y += 14;
    }
    d.moveTo(x, y + 2).lineTo(x + 225, y + 2).lineWidth(0.6).strokeColor("#999999").stroke();
    d.fontSize(8.5).fillColor("#111111").font("Helvetica-Bold").text(total[0], x, y + 7, { width: 155 });
    d.text(total[1], x + 155, y + 7, { width: 70, align: "right" });
    return y + 24;
  };
  const yl = money(d, PAGE.margin, [
    ["Gaji Pokok / Basic Salary", "2,400.00"],
    ["Elaun Kehadiran / Allowance", "150.00"],
    ["Kerja Lebih Masa / Overtime", "0.00"],
  ], "PENDAPATAN / EARNINGS", ["Jumlah Pendapatan / Gross", "2,550.00"]);
  const yr = money(d, 310, [
    ["KWSP / EPF (11%)", "282.00"],
    ["PERKESO / SOCSO", "12.75"],
    ["SIP / EIS", "5.10"],
    ["PCB / MTD", "0.00"],
  ], "POTONGAN / DEDUCTIONS", ["Jumlah Potongan / Total", "299.85"]);
  d.y = Math.max(yl, yr) + 4;

  d.roundedRect(PAGE.margin, d.y, RIGHT - PAGE.margin, 26, 5).fillColor("#eef2f9").fill();
  d.fontSize(10.5).fillColor("#0a1f44").font("Helvetica-Bold")
    .text("GAJI BERSIH / NETT PAY :  RM 2,250.15", PAGE.margin, d.y + 7, { width: RIGHT - PAGE.margin, align: "center" });
  d.moveDown(2.6);
  d.x = PAGE.margin;

  sectionTitle(d, "CARUMAN MAJIKAN / EMPLOYER CONTRIBUTION (TIDAK DITOLAK DARI GAJI)");
  kv(d, "KWSP / EPF (13%)", "RM 333.00");
  kv(d, "PERKESO / SOCSO", "RM 44.65");
  kv(d, "SIP / EIS", "RM 5.10");
  sectionTitle(d, "TAHUN SEHINGGA KINI / YEAR TO DATE (JAN - JUL 2026)");
  kv(d, "Jumlah Pendapatan Kasar", "RM 17,850.00");
  kv(d, "KWSP Pekerja", "RM 1,974.00");
  kv(d, "PERKESO Pekerja", "RM 89.25");
  kv(d, "SIP Pekerja", "RM 35.70");
  d.moveDown(0.6);
  d.fontSize(7.5).fillColor("#555555").font("Helvetica").text(
    "Ini adalah cetakan komputer, tandatangan tidak diperlukan / This is computer generated, no signature is required.",
    PAGE.margin,
  );
};

const genericDocument = (P) => (d) => {
  header(d, [["DOKUMEN SOKONGAN / SUPPORTING DOCUMENT", 12]]);
  kv(d, "Nama", P.name);
  kv(d, "No. K/P", P.id);
  kv(d, "Tarikh", "24 JULAI 2026");
};

/* ----------------------------------------------------------------- doc table */

/** tamper: which false variants are visible on this document — the default
 *  is both, and a document that prints no IC number can only be tampered with
 *  by name. */
const DOCS = [
  { file: "mykad-copy.pdf", title: (P) => `Salinan MyKad - ${P.name}`, build: mykadCopy },
  { file: "police-report-lost-license.pdf", title: (P) => `Repot Polis TAMAN MELAWATI/003412/26 - Kehilangan Lesen Memandu - ${P.name}`, build: policeReport },
  { file: "birth-certificate.pdf", title: (P) => `Sijil Kelahiran (Cabutan) - ${P.name}`, build: birthCertificate },
  { file: "kpp01-result-slip.pdf", title: (P) => `Keputusan Ujian KPP Berkomputer - 47/50 LULUS - ${P.name}`, build: kppSlip },
  { file: "surat-akuan-bujang.pdf", title: (P) => `Akuan Berkanun - Taraf Bujang (Akta 783) - ${P.name}`, build: akuanBujang },
  { file: "hospital-birth-confirmation.pdf", title: (P) => `Pengesahan Kelahiran - Hospital Kuala Lumpur - ${P.name}`, build: hospitalBirth },
  { file: "passport-bio-page.pdf", title: (P) => `Salinan Pasport A${P.digits.slice(0, 8)} - Muka Surat Biodata - ${P.name}`, build: passportBio },
  { file: "tnb-bill.pdf", title: (P) => `TNB Bil Elektrik - RM 65.80 - Akaun 2200${P.digits.slice(0, 8)} - ${P.name}`, build: tnbBill, tamper: ["holder"] },
  { file: "payslip.pdf", title: (P) => `Slip Gaji Julai 2026 - Gaji Bersih RM 2,250.15 - ${P.name}`, build: payslip },
  { file: "generic-document.pdf", title: (P) => `Dokumen Sokongan / Supporting Document - ${P.name}`, build: genericDocument },
];

/** All documents of one person into `dir`; genuine data when donor is null. */
async function writeSet(dir, P, donor) {
  // Rebuilt inline, character by character off the allowlist: the security
  // scan only trusts sanitization done in the same function as the write.
  let target = "";
  for (const ch of insideOut(dir)) {
    let ok = "";
    for (const allowed of PATH_CHARS) {
      if (allowed === ch) {
        ok = allowed;
        break;
      }
    }
    if (!ok) throw new Error("mock set path contains a forbidden character");
    target += ok;
  }
  mkdirSync(target, { recursive: true });
  const manifest = [];
  for (const [i, doc] of DOCS.entries()) {
    if (!donor) {
      await makeDoc(dir, doc.file, doc.title(P), null, doc.build(P));
      manifest.push({ file: doc.file, valid: true });
      continue;
    }
    const modes = doc.tamper ?? ["holder", "id"];
    const mode = modes[(i + P.key) % modes.length];
    const { person: T, note } = tamper(P, donor, mode);
    await makeDoc(dir, doc.file, doc.title(T), note, doc.build(T));
    manifest.push({ file: doc.file, valid: false, mode, note });
  }
  writeFileSync(
    target + "/manifest.json",
    JSON.stringify(
      { citizenKey: P.key, citizenId: P.id, name: P.name, variant: donor ? "false" : "good", files: manifest },
      null,
      2,
    ) + "\n",
  );
}

/* ----------------------------------------------------------------------- run */

const citizens = loadCitizens().map(person);
const byKeyOrId = (token) =>
  citizens.find((c) => String(c.key) === token || c.id === token.toUpperCase());

const argv = process.argv.slice(2);
let selected = [];
if (argv.includes("--all")) {
  selected = citizens;
} else {
  const flag = argv.indexOf("--citizens");
  if (flag !== -1) {
    const tokens = (argv[flag + 1] ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    if (tokens[0] === "all") selected = citizens;
    else {
      for (const token of tokens) {
        const c = byKeyOrId(token) ?? loadPayloadCitizen(token);
        if (!c) {
          console.error(`Unknown citizen "${token}" — use a CitizenKey or citizen ID from the seed CSV or local Payload DB.`);
          process.exit(1);
        }
        if (!selected.includes(c)) selected.push(c);
      }
    }
  }
}

// Default run (no flags): citizen 1 only.
if (!selected.length) selected = [citizens[0]];

for (const P of selected) {
  const donor = citizens[P.key % citizens.length]; // next registry citizen — always a different person
  const base = path.join(OUT, "citizens", P.slug);
  await writeSet(path.join(base, "good"), P, null);
  await writeSet(path.join(base, "false"), P, donor);
  console.log(`MOCKS_GENERATED: ${base} (good + false, donor for false docs: ${donor.name})`);
}
console.log(
  "\nPoint the scanner at a set, e.g.:\n" +
    `  KIOSK_READER_CITIZEN=${selected[0].key} KIOSK_SCANNER_MOCKS=../assets/mocks/citizens/${selected[0].slug}/false npm run dev`,
);
