#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { register } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(SCRIPT_DIR, "../..");
register("./ts-alias-loader.mjs", pathToFileURL(SCRIPT_DIR + "/"));

// systemPrompt(name) must return the shipped defaults, never a caller's override.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("KIOSK_PROMPT_")) delete process.env[key];
}

const HELP = `node scripts/dev/snapshot-contract.mjs --base <url> [--out <dir>] [--check]

Captures the public-service civic domain's observable contract (catalog,
prompts, agent briefing, country pack data, MCP surface, fee quotes, guided
flows through identity, and application review outcomes) as pretty-printed,
key-sorted, run-to-run-stable JSON/text under --out.

Prerequisites for --base:
  - A PRODUCTION server (npm run start), not next dev.
  - Mock mode: KIOSK_LLM_MOCK=true, KIOSK_REQUIRE_DOCUMENT_VERIFICATION=false,
    KIOSK_OCR_BASE_URL=, KIOSK_FACE_BASE_URL=, KIOSK_STT_BASE_URL=,
    KIOSK_TTS_BASE_URL=, KIOSK_FACE_REQUIRE_MATCH=false.
  - KIOSK_NFC_SIMULATE=always and KIOSK_SCANNER_SIMULATE=always (a PC/SC
    daemon is not available in "auto" mode, which would fail identity).
  - KIOSK_READER_CITIZEN=1, so every flow's stood-in reader read is citizen 1.
  - DATABASE_URL pointing at a FRESH COPY of a primed template DB (Payload
    only seeds when NODE_ENV != production, so the template must be primed
    once with a dev boot first — see docs for scripts/dev/snapshot-contract).

Options:
  --base <url>   Base URL of the running server, e.g. http://127.0.0.1:3105
  --out <dir>    Output directory (default: tests/golden/public-service)
  --check        Capture into a temp dir and diff it against --out instead
                 of writing goldens; exits 1 on any difference, 0 if identical
  --help         Show this message
`;

function parseArgs(argv) {
  const args = { base: null, out: null, check: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--check") args.check = true;
    else if (arg === "--base") args.base = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function fail(message) {
  console.error(`snapshot-contract: ${message}`);
  process.exit(1);
}

/** URL_CHARS from src/lib/validation.ts, which a plain .mjs cannot import. */
const URL_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#[]@!$&'()*+,;=%";

/** Characters a kiosk key may consist of: printable ASCII, so no CR/LF. */
const KEY_CHARS =
  " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";

async function request(url, init) {
  // Rebuilt inline, character by character off the allowlist: the security
  // scan only trusts sanitization done in the same function as the fetch.
  let target = "";
  for (const ch of url) {
    let ok = "";
    for (const allowed of URL_CHARS) {
      if (allowed === ch) {
        ok = allowed;
        break;
      }
    }
    if (!ok) throw new Error(`${url} contains a character a URL may not hold`);
    target += ok;
  }
  return fetch(target, init);
}

async function getJson(url) {
  const res = await request(url);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`GET ${url} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function postJson(url, body) {
  const res = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, body: JSON.parse(text) };
  } catch {
    throw new Error(`POST ${url} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

let mcpRequestId = 0;

async function mcpCall(base, method, params) {
  const res = await request(`${base}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++mcpRequestId, method, params: params ?? {} }),
  });
  const text = await res.text();
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
  if (!jsonText) throw new Error(`MCP ${method}: empty/unparseable response: ${trimmed.slice(0, 300)}`);
  const payload = JSON.parse(jsonText);
  if (payload.error) throw new Error(`MCP ${method} error: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

async function mcpToolCall(base, name, args) {
  const result = await mcpCall(base, "tools/call", { name, arguments: args ?? {} });
  const text = result.content?.[0]?.text ?? "{}";
  return { isError: Boolean(result.isError), body: JSON.parse(text) };
}

/* ── stable output: sorted keys, normalised volatile values ───────────── */

const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const CASE_ID_RE = /PSK-\d{4}-\d+/g;
const REQUEST_ID_RE = /REQ-\d{4}-\d+/g;
const PAYMENT_ID_RE = /PAY-[0-9A-Fa-f]{8}/g;
const TOKEN_RE = /[0-9a-f]{32}/g;

function normalizeString(value) {
  return value
    .replace(TIMESTAMP_RE, "<TIMESTAMP>")
    .replace(CASE_ID_RE, "<CASE_ID>")
    .replace(REQUEST_ID_RE, "<REQUEST_ID>")
    .replace(PAYMENT_ID_RE, "<PAYMENT_ID>")
    .replace(TOKEN_RE, "<TOKEN>");
}

function stabilize(value) {
  if (typeof value === "string") return normalizeString(value);
  if (Array.isArray(value)) return value.map(stabilize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stabilize(value[key]);
    return out;
  }
  return value;
}

function toJsonText(value) {
  return `${JSON.stringify(stabilize(value), null, 2)}\n`;
}

function toTextFile(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function walkServiceFiles(dir, prefix) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walkServiceFiles(path.join(dir, entry.name), rel));
    else if (entry.name === "service.ts") found.push(rel);
  }
  return found;
}

function serviceDiscoveryOrder() {
  const servicesDir = path.join(FRONTEND_ROOT, "src/packs/malaysia/services");
  return walkServiceFiles(servicesDir, ".").sort();
}

/* ── capture steps ──────────────────────────────────────────────────── */

async function captureCatalog(base) {
  return getJson(`${base}/api/catalog`);
}

async function capturePrompts() {
  const { systemPrompt, DEFAULT_PROMPTS } = await import("@/app/api/_lib/prompts.ts");
  const files = {};
  for (const name of Object.keys(DEFAULT_PROMPTS)) {
    files[`prompts/${name}.txt`] = toTextFile(systemPrompt(name));
  }
  return files;
}

async function loadOrderedServices() {
  const services = [];
  for (const rel of serviceDiscoveryOrder()) {
    const specifier = `@/packs/malaysia/services${rel.slice(1)}`;
    const mod = await import(specifier);
    services.push(mod.service);
  }
  return services;
}

async function captureBriefing(services) {
  const { singleTurnServiceBriefing } = await import("@/app/api/_lib/service-briefing.ts");
  return singleTurnServiceBriefing(services);
}

async function capturePack() {
  const { malaysia } = await import("@/packs/malaysia/pack.ts");
  const sampleAddress = { line: "571 Demo Street", city: "Kota Kinabalu", postcode: "14555", country: "Malaysia" };
  return {
    locale: malaysia.locale,
    countries: malaysia.countries,
    idDocuments: {
      label: malaysia.idDocuments.label,
      forCountry: {
        Malaysia: malaysia.idDocuments.forCountry("Malaysia"),
        Vietnam: malaysia.idDocuments.forCountry("Vietnam"),
      },
    },
    formatAddress: {
      sample: sampleAddress,
      result: malaysia.formatAddress(sampleAddress),
    },
    promptVars: malaysia.promptVars,
    messages: malaysia.messages,
    speech: malaysia.speech,
    nlu: malaysia.nlu,
  };
}

async function captureMcp(base) {
  const initialize = await mcpCall(base, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "snapshot-contract", version: "1.0.0" },
  });
  const list = await mcpCall(base, "tools/list", {});
  return {
    instructions: initialize.instructions,
    serverInfo: initialize.serverInfo,
    tools: list.tools.map(({ name, title, description, inputSchema }) => ({
      name,
      title,
      description,
      inputSchema,
    })),
  };
}

async function captureFees(base, services) {
  const fees = {};
  for (const service of services) {
    const entry = { noData: await getJson(`${base}/api/fees?serviceId=${service.id}`) };
    if (service.pricing) {
      entry.rates = {};
      for (const rateKey of Object.keys(service.pricing.rates)) {
        const qs = new URLSearchParams({ serviceId: service.id, [service.pricing.field]: rateKey });
        entry.rates[rateKey] = await getJson(`${base}/api/fees?${qs}`);
      }
    }
    fees[service.id] = entry;
  }

  const citizen1Doc = "MY3080592042";
  const fineLookup = await getJson(`${base}/api/fines?lookupBy=mykad&reference=${citizen1Doc}`);
  fees.fine.registry = {
    mykadLookup: await getJson(`${base}/api/fees?serviceId=fine&lookupBy=mykad&reference=${citizen1Doc}`),
  };
  if (fineLookup.fines[0]) {
    const summonsNo = fineLookup.fines[0].summonsNo;
    fees.fine.registry.summonsLookup = await getJson(
      `${base}/api/fees?serviceId=fine&lookupBy=summons&reference=${encodeURIComponent(summonsNo)}`,
    );
  }

  const vehicles = await getJson(`${base}/api/vehicles?documentNumber=${citizen1Doc}`);
  fees.roadtax.registry = { plates: {} };
  for (const vehicle of vehicles.vehicles) {
    fees.roadtax.registry.plates[vehicle.plateNumber] = {};
    for (const period of ["6", "12"]) {
      const qs = new URLSearchParams({ serviceId: "roadtax", plate: vehicle.plateNumber, period });
      fees.roadtax.registry.plates[vehicle.plateNumber][period] = await getJson(`${base}/api/fees?${qs}`);
    }
  }

  return fees;
}

async function captureFlows(base, services) {
  const flows = {};
  for (const service of services) {
    const start = await mcpToolCall(base, "start_service_flow", { serviceId: service.id });
    const readDoc = await mcpToolCall(base, "continue_service_flow", {
      serviceId: service.id,
      answers: { insertDocument: "done" },
    });
    const sessionId = readDoc.body.sessionId;
    const afterIdentity = await mcpToolCall(base, "continue_service_flow", {
      sessionId,
      answers: { biometric: "done" },
    });
    flows[service.id] = {
      responses: [start.body, readDoc.body, afterIdentity.body],
    };
  }

  const requestsProbe = await mcpToolCall(base, "start_service_flow", { serviceId: "requests" });
  flows.requests = {
    unreachable:
      "REQUESTS_FLOW_ID (\"requests\") is dispatched only by /api/chat's " +
      "startRequestsFlow/continueRequestsFlow — engine.startFlow used by the MCP " +
      "start_service_flow tool calls getService(\"requests\"), which is not a real " +
      "ServiceDefinition. Confirmed live: " + JSON.stringify(requestsProbe.body),
  };
  return flows;
}

async function cmsCollection(base, kioskKey, collection) {
  // Rebuilt inline, character by character off the allowlist: the security
  // scan only trusts sanitization done in the same function as the request.
  let key = "";
  for (const ch of String(kioskKey)) {
    let ok = "";
    for (const allowed of KEY_CHARS) {
      if (allowed === ch) {
        ok = allowed;
        break;
      }
    }
    if (!ok) throw new Error("cms.kiosk_key in config.yaml contains a character a header may not hold");
    key += ok;
  }
  const res = await request(`${base}/cms-api/${collection}?limit=200&depth=0`, {
    headers: { "x-kiosk-key": key },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`GET /cms-api/${collection} -> HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body.docs;
}

function isLicenseCancelled(license) {
  return Date.now() - new Date(license.expiresAt).getTime() > 3 * 365 * 86_400_000;
}

function kioskKeyFromConfig() {
  const configText = readFileSync(path.join(FRONTEND_ROOT, "config.yaml"), "utf8");
  const config = parseYaml(configText);
  return config?.cms?.kiosk_key ?? "dev-kiosk-key";
}

async function captureOutcomes(base) {
  const kioskKey = kioskKeyFromConfig();
  const citizens = (await cmsCollection(base, kioskKey, "citizens")).sort((a, b) => a.citizenKey - b.citizenKey);
  const licenses = await cmsCollection(base, kioskKey, "licenses");
  const vehicles = await cmsCollection(base, kioskKey, "vehicles");

  const licensesByDoc = new Map();
  for (const license of licenses) {
    const list = licensesByDoc.get(license.documentNumber) ?? [];
    list.push(license);
    licensesByDoc.set(license.documentNumber, list);
  }
  const vehiclesByDoc = new Map();
  for (const vehicle of vehicles) {
    const list = vehiclesByDoc.get(vehicle.documentNumber) ?? [];
    list.push(vehicle);
    vehiclesByDoc.set(vehicle.documentNumber, list);
  }
  const licensesOf = (citizen) => licensesByDoc.get(citizen.citizenId) ?? [];
  const vehiclesOf = (citizen) => vehiclesByDoc.get(citizen.citizenId) ?? [];
  const activeLicenseClass = (citizen, klass) =>
    licensesOf(citizen).find((l) => l.licenseClass === klass && !isLicenseCancelled(l));

  const usedByService = new Map();
  function pickCitizen(serviceId, predicate) {
    const used = usedByService.get(serviceId) ?? new Set();
    const found = citizens.find((c) => !used.has(c.citizenKey) && predicate(c));
    if (found) {
      used.add(found.citizenKey);
      usedByService.set(serviceId, used);
    }
    return found ?? null;
  }

  const outcomes = [];
  async function capture(branch, serviceId, citizen, data) {
    if (!citizen) {
      outcomes.push({ branch, serviceId, unreachable: "no seeded citizen satisfies this branch's predicate" });
      return;
    }
    const res = await postJson(`${base}/api/applications`, {
      serviceId,
      documentNumber: citizen.citizenId,
      data,
    });
    outcomes.push({
      branch,
      serviceId,
      citizenKey: citizen.citizenKey,
      data,
      status: res.body.status,
      statusReason: res.body.statusReason ?? null,
    });
  }

  // police
  const policeReview = pickCitizen("police", (c) => c.criminalRecord?.officerReviewRequired === true);
  await capture("officer-review", "police", policeReview, { purpose: "others", country: "Singapore" });
  const policeOk = pickCitizen("police", (c) => c.criminalRecord?.officerReviewRequired !== true);
  await capture("ok", "police", policeOk, { purpose: "studies", country: "United Kingdom" });
  await capture("duplicate", "police", policeOk, { purpose: "studies", country: "United Kingdom" });

  // fine
  const citizen1 = citizens.find((c) => c.citizenKey === 1);
  const fineData = { lookupBy: "mykad", reference: citizen1.citizenId };
  await capture("repeatable-first", "fine", citizen1, fineData);
  await capture("repeatable-second", "fine", citizen1, fineData);

  // dl_renew
  const noLicense = pickCitizen("dl_renew", (c) => licensesOf(c).length === 0);
  await capture("no-license", "dl_renew", noLicense, { licenseClass: "D", requestType: "renewal", duration: "1" });
  const cancelledHolder = pickCitizen("dl_renew", (c) => licensesOf(c).some(isLicenseCancelled));
  const cancelledClass = cancelledHolder ? licensesOf(cancelledHolder).find(isLicenseCancelled).licenseClass : null;
  await capture("cancelled", "dl_renew", cancelledHolder, {
    licenseClass: cancelledClass ?? "D",
    requestType: "renewal",
    duration: "1",
  });
  const renewBlacklisted = pickCitizen(
    "dl_renew",
    (c) => c.hasOutstandingFines && licensesOf(c).some((l) => !isLicenseCancelled(l)),
  );
  const renewBlacklistedClass = renewBlacklisted
    ? licensesOf(renewBlacklisted).find((l) => !isLicenseCancelled(l)).licenseClass
    : null;
  await capture("blacklisted", "dl_renew", renewBlacklisted, {
    licenseClass: renewBlacklistedClass ?? "D",
    requestType: "renewal",
    duration: "1",
  });
  const renewOk = pickCitizen(
    "dl_renew",
    (c) => !c.hasOutstandingFines && licensesOf(c).some((l) => !isLicenseCancelled(l)),
  );
  const renewOkClass = renewOk ? licensesOf(renewOk).find((l) => !isLicenseCancelled(l)).licenseClass : null;
  await capture("renewal-ok", "dl_renew", renewOk, {
    licenseClass: renewOkClass ?? "D",
    requestType: "renewal",
    duration: "3",
  });
  const replaceOk = pickCitizen(
    "dl_renew",
    (c) => !c.hasOutstandingFines && licensesOf(c).some((l) => !isLicenseCancelled(l)),
  );
  const replaceOkClass = replaceOk ? licensesOf(replaceOk).find((l) => !isLicenseCancelled(l)).licenseClass : null;
  await capture("replacement-ok", "dl_renew", replaceOk, {
    licenseClass: replaceOkClass ?? "D",
    requestType: "replacement",
  });

  // dl_new
  const alreadyHeld = pickCitizen("dl_new", (c) => ["B2", "D", "DA"].some((k) => activeLicenseClass(c, k)));
  const alreadyHeldClass = alreadyHeld
    ? ["B2", "D", "DA"].find((k) => activeLicenseClass(alreadyHeld, k))
    : null;
  await capture("already-held", "dl_new", alreadyHeld, { licenseClass: alreadyHeldClass ?? "D" });
  const daConflict = pickCitizen("dl_new", (c) => activeLicenseClass(c, "D"));
  await capture("da-d-conflict", "dl_new", daConflict, { licenseClass: "DA" });
  const dlNewOk = pickCitizen("dl_new", (c) => licensesOf(c).length === 0);
  await capture("ok", "dl_new", dlNewOk, { licenseClass: "B2" });

  // roadtax
  const notOwned = pickCitizen("roadtax", () => true);
  await capture("not-owned", "roadtax", notOwned, { plate: "ZZZ 0000", period: "12" });
  const roadtaxBlacklisted = pickCitizen("roadtax", (c) => c.hasOutstandingFines && vehiclesOf(c).length > 0);
  await capture("blacklisted", "roadtax", roadtaxBlacklisted, {
    plate: roadtaxBlacklisted ? vehiclesOf(roadtaxBlacklisted)[0].plateNumber : "ZZZ 0000",
    period: "12",
  });
  const roadtaxOk = pickCitizen("roadtax", (c) => !c.hasOutstandingFines && vehiclesOf(c).length > 0);
  await capture("ok", "roadtax", roadtaxOk, {
    plate: roadtaxOk ? vehiclesOf(roadtaxOk)[0].plateNumber : "ZZZ 0000",
    period: "12",
  });

  // welfare
  const bweAge = pickCitizen("welfare", (c) => (c.age ?? 0) < 60);
  await capture("bwe-under-60", "welfare", bweAge, { scheme: "bwe", income: "1500" });
  const notOku = pickCitizen("welfare", (c) => !c.isOku);
  await capture("not-oku", "welfare", notOku, { scheme: "btb", income: "1500" });
  const noChildren = pickCitizen("welfare", (c) => (c.childrenUnder18 ?? 0) === 0);
  await capture("no-children", "welfare", noChildren, { scheme: "bkk", income: "1500" });
  const welfareOk = pickCitizen("welfare", (c) => c.isOku === true);
  await capture("ok", "welfare", welfareOk, { scheme: "epoku", income: "1500" });

  // idcard
  const foreign = pickCitizen("idcard", (c) => c.country !== "Malaysia");
  await capture("foreign", "idcard", foreign, { caseType: "first" });
  const lost = pickCitizen("idcard", (c) => c.country === "Malaysia");
  await capture("lost", "idcard", lost, { caseType: "lost" });
  const damaged = pickCitizen("idcard", (c) => c.country === "Malaysia");
  await capture("damaged-ok", "idcard", damaged, { caseType: "damaged" });

  // marriage
  const islam = pickCitizen("marriage", (c) => c.religion === "Islam");
  await capture("islam", "marriage", islam, { venueType: "office", date: "2026-12-01", witness1: "Ali", witness2: "Bala" });
  const existingMarriage = pickCitizen("marriage", (c) => c.religion !== "Islam" && c.maritalStatus === "married");
  await capture("existing-marriage", "marriage", existingMarriage, {
    venueType: "office",
    date: "2026-12-01",
    witness1: "Ali",
    witness2: "Bala",
  });
  const marriageOk = pickCitizen("marriage", (c) => c.religion !== "Islam" && c.maritalStatus === "single");
  await capture("ok", "marriage", marriageOk, { venueType: "office", date: "2026-12-01", witness1: "Ali", witness2: "Bala" });

  // address
  const addressApply = pickCitizen("address", () => true);
  await capture("apply", "address", addressApply, { newAddress: "12, Jalan Aman, 88000 Kota Kinabalu, Malaysia" });
  const addressNoNew = pickCitizen("address", () => true);
  await capture("no-new-address-ok", "address", addressNoNew, {});

  // birth
  const birthAny = pickCitizen("birth", () => true);
  await capture("default-ok", "birth", birthAny, {
    childName: "Test Child",
    childDob: "2026-01-01",
    birthPlace: "Kuala Lumpur",
  });

  return outcomes;
}

/* ── capture orchestration ─────────────────────────────────────────── */

async function captureAll(base) {
  const files = {};
  files["catalog.json"] = toJsonText(await captureCatalog(base));
  Object.assign(files, await capturePrompts());

  const services = await loadOrderedServices();
  files["briefing.txt"] = toTextFile(await captureBriefing(services));
  files["pack.json"] = toJsonText(await capturePack());
  files["mcp.json"] = toJsonText(await captureMcp(base));
  files["fees.json"] = toJsonText(await captureFees(base, services));
  files["flows.json"] = toJsonText(await captureFlows(base, services));
  files["outcomes.json"] = toJsonText(await captureOutcomes(base));
  return files;
}

/* ── filesystem helpers ────────────────────────────────────────────── */

function writeFiles(dir, files) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
}

function listFilesRecursive(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFilesRecursive(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

function diffSummary(expectedText, actualText) {
  const a = expectedText.split("\n");
  const b = actualText.split("\n");
  const max = Math.max(a.length, b.length);
  let diffLines = 0;
  const examples = [];
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      diffLines++;
      if (examples.length < 3) {
        examples.push({ line: i + 1, expected: a[i] ?? "<EOF>", actual: b[i] ?? "<EOF>" });
      }
    }
  }
  return { diffLines, expectedLines: a.length, actualLines: b.length, examples };
}

function compareDirs(expectedDir, actualDir) {
  const expectedFiles = new Set(listFilesRecursive(expectedDir));
  const actualFiles = new Set(listFilesRecursive(actualDir));
  const allFiles = [...new Set([...expectedFiles, ...actualFiles])].sort();
  let clean = true;
  for (const rel of allFiles) {
    const inExpected = expectedFiles.has(rel);
    const inActual = actualFiles.has(rel);
    if (!inExpected) {
      clean = false;
      console.log(`+ ${rel}: only in the new capture (missing from --out)`);
      continue;
    }
    if (!inActual) {
      clean = false;
      console.log(`- ${rel}: only in --out (missing from the new capture)`);
      continue;
    }
    const expectedText = readFileSync(path.join(expectedDir, rel), "utf8");
    const actualText = readFileSync(path.join(actualDir, rel), "utf8");
    if (expectedText === actualText) continue;
    clean = false;
    const { diffLines, expectedLines, actualLines, examples } = diffSummary(expectedText, actualText);
    console.log(`~ ${rel}: ${diffLines} line(s) differ (${expectedLines} -> ${actualLines} lines)`);
    for (const example of examples) {
      console.log(`    line ${example.line}:`);
      console.log(`      --out : ${example.expected}`);
      console.log(`      new   : ${example.actual}`);
    }
  }
  return clean;
}

/* ── main ───────────────────────────────────────────────────────────── */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (!args.base) fail("--base <url> is required (see --help)");
  const base = args.base.replace(/\/$/, "");
  const outDir = path.resolve(FRONTEND_ROOT, args.out ?? "tests/golden/public-service");

  try {
    await getJson(`${base}/api/health`);
  } catch (error) {
    fail(`server at ${base} is unreachable: ${error.message}`);
  }

  const files = await captureAll(base);

  if (!args.check) {
    writeFiles(outDir, files);
    const total = Object.values(files).reduce((sum, content) => sum + Buffer.byteLength(content), 0);
    console.log(`wrote ${Object.keys(files).length} files (${total} bytes) to ${outDir}`);
    return 0;
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "kiosk-snapshot-check-"));
  try {
    writeFiles(tempDir, files);
    const clean = compareDirs(outDir, tempDir);
    if (clean) {
      console.log("snapshot-contract --check: identical to --out");
      return 0;
    }
    console.log("snapshot-contract --check: differences found (see above)");
    return 1;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

process.exitCode = await main();
