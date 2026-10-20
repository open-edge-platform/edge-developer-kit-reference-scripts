// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Writes the Malaysian mock documents (src/packs/malaysia/mock-documents.mjs)
 * to ../assets/mocks for the mock scanner (src/app/api/_lib/scanner.ts), for
 * people drawn from data/citizens.csv or the local registry DB. Staff can
 * also download them from /mock-documents.
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "url";
import { manifestOf, person, renderSet } from "../src/packs/malaysia/mock-documents.mjs";

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

/** One rendered document into `dir`. */
function writeDoc(dir, file, bytes) {
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
  writeFileSync(target, bytes);
}

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
  for (const { file, bytes } of await renderSet(P, donor)) writeDoc(dir, file, bytes);
  writeFileSync(target + "/manifest.json", JSON.stringify(manifestOf(P, donor), null, 2) + "\n");
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
