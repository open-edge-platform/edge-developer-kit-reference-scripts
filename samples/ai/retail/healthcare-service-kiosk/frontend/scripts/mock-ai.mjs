#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Stand-in for the Edge AI Studio gateway: LLM (chat agent + one-shot JSON),
// OCR, face recognition, STT and TTS on one port. Nothing here is AI.
//
//   node scripts/mock-ai.mjs            # http://127.0.0.1:8090
//   MOCK_AI_FACE=mismatch|none          # face check outcome (default match)
//   MOCK_AI_HEARD="phrase one|phrase two"   # what the "microphone" hears, in turn

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const PORT = Number(process.env.MOCK_AI_PORT ?? 8090);
const KIOSK_ROOT = path.resolve(import.meta.dirname, "../..");
const PDF_DIRS = ["assets/mocks", "assets/pdf"].map((dir) => path.join(KIOSK_ROOT, dir));
// Must equal the kiosk's ocr dpi, or rendered pages never hash the same.
const OCR_DPI = process.env.KIOSK_OCR_DPI ?? "300";
const FACE = process.env.MOCK_AI_FACE ?? "match";
const HEARD = (process.env.MOCK_AI_HEARD ?? "I'd like to check in for my appointment")
  .split("|")
  .map((phrase) => phrase.trim())
  .filter(Boolean);
const UNKNOWN_PAGE = "[mock OCR: page not found among the kit's PDFs]";

const sha1 = (bytes) => createHash("sha1").update(bytes).digest("hex");
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

/* ── OCR: a page rendered from a known PDF gets that PDF's text layer ──── */

const pageText = new Map();
const indexed = new Set();
let indexing = null;

async function indexPdf(file) {
  const dir = await mkdtemp(path.join(tmpdir(), "mock-ocr-"));
  try {
    await exec("pdftoppm", ["-r", OCR_DPI, "-png", file, path.join(dir, "page")]);
    const pages = (await readdir(dir)).filter((name) => name.endsWith(".png")).sort();
    for (const [index, page] of pages.entries()) {
      const n = String(index + 1);
      const { stdout } = await exec("pdftotext", ["-layout", "-f", n, "-l", n, file, "-"]);
      const text = stdout
        .split("\n")
        .map((line) => line.trim().replace(/\s{2,}/g, "  "))
        .filter(Boolean)
        .join("\n");
      pageText.set(sha1(await readFile(path.join(dir, page))), text);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function refreshIndex() {
  for (const dir of PDF_DIRS) {
    const entries = await readdir(dir, { recursive: true }).catch(() => []);
    for (const entry of entries.filter((name) => name.endsWith(".pdf"))) {
      const file = path.join(dir, entry);
      const key = `${file}@${(await stat(file)).mtimeMs}`;
      if (indexed.has(key)) continue;
      indexed.add(key);
      await indexPdf(file).catch((error) => log("ocr: could not index", file, error.message));
    }
  }
}

const reindex = () => (indexing ??= refreshIndex().finally(() => (indexing = null)));

async function ocr(form) {
  const file = form.get("file");
  if (!(file instanceof Blob)) return { status: 400, json: { detail: "file is required" } };
  const hash = sha1(Buffer.from(await file.arrayBuffer()));
  if (!pageText.has(hash)) await reindex();
  const text = pageText.get(hash) ?? `Scanned document\n${UNKNOWN_PAGE}`;
  log("ocr:", text.split("\n")[0]);
  return { json: { full_text: text } };
}

/* ── Face: one face in frame, the most recently enrolled person ─────────── */

const gallery = new Map();
let nextPersonId = 1;
let lastEnrolled = null;

function enroll(form) {
  const name = String(form.get("name") ?? "");
  const person = { id: `mock-${nextPersonId++}`, name, num_images: form.getAll("files").length };
  gallery.set(person.id, person);
  lastEnrolled = person;
  log("face: enrolled", name);
  return { json: { person } };
}

function recognize() {
  const base = { gallery_size: gallery.size, threshold: 0.4 };
  if (FACE === "none") return { json: { ...base, num_faces: 0, faces: [] } };
  const person = FACE === "match" && lastEnrolled && gallery.has(lastEnrolled.id) ? lastEnrolled : null;
  const similarities = [...gallery.values()].map((p) => ({
    person_id: p.id,
    name: p.name,
    similarity: p === person ? 0.92 : 0.11,
  }));
  const match = person ? { person_id: person.id, name: person.name, similarity: 0.92 } : null;
  log("face:", person ? `match ${person.name}` : "no match");
  return {
    json: { ...base, num_faces: 1, faces: [{ score: 0.99, matched: Boolean(match), match, similarities }] },
  };
}

/* ── Speech ────────────────────────────────────────────────────────────── */

let heardIndex = 0;

function transcribe(form) {
  const text = HEARD[heardIndex++ % HEARD.length] ?? "";
  log("stt:", text);
  return { json: { text, language: String(form.get("language") ?? "en") } };
}

const ESPEAK_LANGUAGE = { a: "en-us", b: "en-gb", e: "es", f: "fr", h: "hi", i: "it", j: "ja", p: "pt", z: "cmn" };

function silentWav(seconds) {
  const rate = 16_000;
  const data = Math.round(rate * seconds) * 2;
  const wav = Buffer.alloc(44 + data);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + data, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(data, 40);
  return wav;
}

async function speak(body) {
  const text = String(body.input ?? "").slice(0, 1_500);
  const language = ESPEAK_LANGUAGE[String(body.voice ?? "a")[0]] ?? "en-us";
  const wpm = String(Math.round(170 * Number(body.speed ?? 1)));
  log("tts:", text.slice(0, 60));
  try {
    const { stdout } = await exec("espeak-ng", ["--stdout", "-v", language, "-s", wpm, text], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { audio: stdout };
  } catch {
    return { audio: silentWav(Math.min(8, 0.25 * text.split(/\s+/).length)) };
  }
}

/* ── LLM: one-shot JSON tasks ──────────────────────────────────────────── */

const normalize = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
/** Whether `text` holds something shaped like `id`: any digit where it has one, its other characters as they are. */
function hasIdShape(text, id) {
  for (let at = 0; at + id.length <= text.length; at++) {
    let same = true;
    for (let i = 0; i < id.length && same; i++) {
      same = /\d/.test(id[i]) ? /\d/.test(text[at + i]) : id[i] === text[at + i];
    }
    if (same) return true;
  }
  return false;
}

function verdict(prompt) {
  const field = (label) =>
    prompt
      .split("\n")
      .find((line) => line.startsWith(`${label}: `) && line.length > label.length + 2)
      ?.slice(label.length + 2)
      .trim();
  const name = field("Expected document holder") ?? field("Applicant");
  const nationalId = field("Expected national ID number");
  const related = field("Family member to link");
  const text = prompt.split('"""')[1] ?? "";
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const documentType = lines[0] ?? "Document";
  const printed = (value) => !value || normalize(text).includes(normalize(value));

  const problems = [];
  if (!text.includes(UNKNOWN_PAGE)) {
    if (!printed(name)) problems.push(`${name} is not named on it`);
    if (related && !printed(related)) problems.push(`${related} is not named on it`);
    if (nationalId && !printed(nationalId) && hasIdShape(text, nationalId)) {
      problems.push(`the ID number on it is not ${nationalId}`);
    }
  }
  const wantsAddress = prompt.includes('"address"');
  return {
    documentType,
    holderName: name && printed(name) ? name : null,
    typeMatches: true,
    ...(wantsAddress ? { address: lines.find((line) => /\b\d{5}\b/.test(line)) ?? null } : {}),
    matches: problems.length === 0,
    summary: problems.length
      ? `Simulated check — ${problems.join("; ")}.`
      : `Simulated check — ${documentType} accepted.`,
  };
}

function grouping(prompt) {
  const documents = [];
  for (const [, page, body] of prompt.matchAll(/--- Sheet (\d+) ---\n([\s\S]*?)(?=\n--- Sheet |\nGroup the sheets)/g)) {
    const heading = body.split("\n").map((line) => line.trim()).find(Boolean) ?? "Document";
    const last = documents.at(-1);
    if (last && last.documentType === heading) last.pages.push(Number(page));
    else documents.push({ pages: [Number(page)], documentType: heading });
  }
  return { documents };
}

function oneShot(messages) {
  const prompt = textOf(messages.findLast((m) => m.role === "user"));
  if (prompt.includes("Group the sheets")) return grouping(prompt);
  if (prompt.includes('"matches"')) return verdict(prompt);
  if (prompt.includes('{"language"')) {
    return { language: prompt.match(/return "([^"]+)"\.?\s*$/)?.[1] ?? "en" };
  }
  if (prompt.includes('{"text"')) {
    return { text: [...prompt.matchAll(/Transcript: "([\s\S]*?)"\n/g)].at(-1)?.[1] ?? "" };
  }
  return {};
}

/* ── LLM: the chat agent ───────────────────────────────────────────────── */

const STOPWORDS = new Set(
  ("i im id ill a an the my me to for of and or please can could you help with need want " +
    "would like is are in on at do does how what get some this that it its be am " +
    "your have has hi hello hey yes no").split(" "),
);

const stem = (word) =>
  word.length > 5 && word.endsWith("ing")
    ? word.slice(0, -3)
    : word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
      ? word.slice(0, -1)
      : word;

const words = (s) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !STOPWORDS.has(word))
    .map(stem);

const SYNONYMS = {
  owe: "balance invoice",
  pay: "balance invoice",
  bill: "balance invoice",
  cardiologist: "specialist",
  dermatologist: "specialist",
  surgeon: "specialist",
  where: "directions",
  pharmacy: "directions pharmacy",
  toilet: "directions",
  hour: "hours general information services departments",
  open: "hours general information services departments",
  here: "check today",
  mri: "procedure",
  scan: "procedure",
  surgery: "procedure",
  medicine: "prescriptions",
  pill: "prescriptions",
  queue: "check",
  arrived: "check",
};

const expand = (said) => said.flatMap((word) => [word, ...(SYNONYMS[word] ? words(SYNONYMS[word]) : [])]);

const overlap = (said, target) => {
  const wanted = new Set(words(target));
  return new Set(said.filter((word) => wanted.has(word))).size;
};

function textOf(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return (message.content ?? []).map((part) => part.text ?? "").join("\n");
}

function catalogFrom(system) {
  return [...system.matchAll(/^- ([\w-]+): (.+?) — (.+)$/gm)].map(([, id, label, description]) => ({
    id,
    label,
    description,
  }));
}

function matchService(spoken, catalog, minimum) {
  const said = expand(words(spoken));
  let best = null;
  for (const service of catalog) {
    const score =
      2 * overlap(said, service.label) +
      overlap(said, service.description) +
      overlap(said, service.id.replace(/-/g, " "));
    if (score >= minimum && score > (best?.score ?? 0)) best = { ...service, score };
  }
  return best;
}

function parseBriefing(userText) {
  const at = userText.indexOf("[kiosk]");
  const spoken = (at === -1 ? userText : userText.slice(0, at)).trim();
  const briefing = at === -1 ? "" : userText.slice(at);
  const flow = briefing.match(/Current flow: serviceId "([^"]+)", sessionId (?:"([^"]+)"|null)/);
  const asks = [...briefing.matchAll(/^- (\S+) \((\w+)(, optional)?\): (.*)$/gm)].map(
    ([, id, type, optional, rest]) => {
      const values = rest.split(" — allowed values: ")[1] ?? "";
      return {
        id,
        type,
        optional: Boolean(optional),
        question: rest.split(" — ")[0],
        options: [...values.matchAll(/"([^"]*)" \(([^)]*)\)/g)].map(([, value, label]) => ({ value, label })),
      };
    },
  );
  return {
    spoken,
    tapped: briefing.match(/The patient tapped the service "([^"]+)"/)?.[1],
    onScreen: /The patient (answered on screen|supplied a document)/.test(briefing),
    flow: flow ? { serviceId: flow[1], sessionId: flow[2] ?? null } : null,
    asks,
  };
}

const YES = /\b(yes|yeah|yep|sure|ok|okay|confirm|correct|right|proceed|continue|agree|go ahead)\b/;
const NO = /\b(no|nope|cancel|stop|decline|dont|not now|skip)\b/;
const ORDINALS = [/\b(1|one|first)\b/, /\b(2|two|second)\b/, /\b(3|three|third)\b/, /\b(4|four|fourth)\b/];

function pickOption(spoken, options) {
  const said = spoken.toLowerCase().replace(/['’]/g, "").trim();
  const exact = options.find((o) => [o.value, o.label].some((v) => v.toLowerCase() === said));
  if (exact) return exact.value;
  const tokens = words(spoken);
  let best = null;
  for (const option of options) {
    const score = overlap(tokens, `${option.label} ${option.value}`);
    if (score > (best?.score ?? 0)) best = { value: option.value, score };
  }
  if (best) return best.value;
  const polar = (re) => options.find((o) => re.test(`${o.value} ${o.label}`.toLowerCase()));
  if (NO.test(said)) return polar(/^(no|cancel|decline|skip|not)/)?.value ?? null;
  if (YES.test(said)) return polar(/^(yes|confirm|continue|proceed|agree|accept|ok|pay)/)?.value ?? null;
  if (said.split(/\s+/).length <= 4) {
    const index = ORDINALS.findIndex((re) => re.test(said));
    if (index !== -1 && options[index]) return options[index].value;
  }
  return null;
}

function answersFrom(spoken, asks) {
  if (!spoken) return {};
  for (const ask of asks.filter((a) => a.options.length > 0)) {
    const value = pickOption(spoken, ask.options);
    if (value !== null) return { [ask.id]: value };
  }
  const textAsk = asks.find((a) => a.type === "text" && !a.optional) ?? asks.find((a) => a.type === "text");
  if (textAsk) return { [textAsk.id]: spoken };
  // Like a real model, hand over words no choice matched: the flow searches them ("cholesterol" → Lipid Profile) or asks again.
  const choice = asks.find((a) => a.options.length > 0);
  return choice && words(spoken).length > 0 && !NO.test(spoken.toLowerCase()) ? { [choice.id]: spoken } : {};
}

const say = (content) => ({ content });
const call = (name, args) => ({ toolCall: { name, args } });

const parsed = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

function relay(toolMessage) {
  let result = parsed(textOf(toolMessage));
  if (!result) return say(textOf(toolMessage));
  if (typeof result.error === "string") {
    const failed = parsed(result.error);
    if (!failed?.say) return say(`Sorry — ${result.error}`);
    result = failed;
  }
  const said = String(result?.say ?? "");
  const next = (result?.asks ?? []).find((ask) => ask.question && !said.includes(ask.question));
  return say([said, next?.question].filter(Boolean).join(" ") || "Done.");
}

function agentTurn(messages) {
  const last = messages.at(-1);
  if (last?.role === "tool") return relay(last);

  const catalog = catalogFrom(textOf(messages.find((m) => m.role === "system")));
  const { spoken, tapped, onScreen, flow, asks } = parseBriefing(textOf(last));
  const ref = flow?.sessionId ? { sessionId: flow.sessionId } : { serviceId: flow?.serviceId };

  if (tapped) return call("start_service_flow", { serviceId: tapped });
  if (flow && onScreen) return call("continue_service_flow", ref);
  if (flow) {
    const answers = answersFrom(spoken, asks);
    if (Object.keys(answers).length > 0) return call("continue_service_flow", { ...ref, answers });
    const other = matchService(spoken, catalog, 2);
    if (other && other.id !== flow.serviceId) return call("start_service_flow", { serviceId: other.id });
    if (asks.some((a) => a.type === "action")) {
      return say("That step happens at the kiosk itself — please follow the on-screen prompt.");
    }
    if (asks.some((a) => a.type === "document")) {
      return say("Please scan or upload the document shown on screen.");
    }
    const choices = asks.flatMap((a) => a.options.map((o) => o.label));
    return say(`Sorry, I didn't catch that.${choices.length ? ` You can say: ${choices.join(", ")}.` : ""}`);
  }
  const service = matchService(spoken, catalog, 1);
  if (service) return call("start_service_flow", { serviceId: service.id });
  if (/\b(thanks?|thank you|bye|goodbye)\b/i.test(spoken)) return say("You're welcome — take care!");
  const offered = catalog.slice(0, 6).map((s) => s.label.toLowerCase());
  return say(`Hello! I'm the kiosk's mock assistant. I can help with ${offered.join(", ")} and more — what do you need?`);
}

/* ── OpenAI-compatible wire format ─────────────────────────────────────── */

let callCount = 0;

async function streamReply(res, model, reply) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const id = `chatcmpl-mock-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish_reason = null) =>
    res.write(
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
    );
  chunk({ role: "assistant", content: "" });
  if (reply.toolCall) {
    const { name, args } = reply.toolCall;
    chunk({
      tool_calls: [
        { index: 0, id: `call_mock_${++callCount}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
      ],
    });
  } else {
    for (const piece of reply.content.match(/\S+\s*/g) ?? []) {
      chunk({ content: piece });
      await new Promise((resolve) => setTimeout(() => resolve(), 10));
    }
  }
  chunk({}, reply.toolCall ? "tool_calls" : "stop");
  res.end("data: [DONE]\n\n");
}

async function chatCompletions(body, res) {
  const model = body.model ?? "mock";
  const messages = body.messages ?? [];
  if (body.stream) {
    const reply = agentTurn(messages);
    log("llm:", reply.toolCall ? `${reply.toolCall.name} ${JSON.stringify(reply.toolCall.args)}` : reply.content.slice(0, 80));
    return streamReply(res, model, reply);
  }
  const content = JSON.stringify(oneShot(messages));
  log("llm:", content.slice(0, 100));
  sendJson(res, 200, {
    id: `chatcmpl-mock-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

/* ── HTTP ──────────────────────────────────────────────────────────────── */

function sendJson(res, status, json) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(json));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const formOf = (req, bytes) =>
  new Response(bytes, { headers: { "content-type": req.headers["content-type"] ?? "" } }).formData();

async function handle(req, res) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1").pathname.replace(/\/+$/, "");
  const bytes = await readBody(req);
  const send = ({ status = 200, json }) => sendJson(res, status, json);

  if (req.method === "POST" && url.endsWith("/chat/completions")) {
    return chatCompletions(JSON.parse(bytes.toString() || "{}"), res);
  }
  if (req.method === "POST" && url.endsWith("/ocr")) return send(await ocr(await formOf(req, bytes)));
  if (req.method === "POST" && url.endsWith("/recognize")) return send(recognize());
  if (req.method === "POST" && url.endsWith("/gallery")) return send(enroll(await formOf(req, bytes)));
  if (req.method === "GET" && url.endsWith("/gallery")) return send({ json: { persons: [...gallery.values()] } });
  if (req.method === "DELETE" && /\/gallery\/[^/]+$/.test(url)) {
    gallery.delete(decodeURIComponent(url.split("/").at(-1)));
    return send({ json: { deleted: true } });
  }
  if (req.method === "POST" && url.endsWith("/audio/transcriptions")) {
    return send(transcribe(await formOf(req, bytes)));
  }
  if (req.method === "POST" && url.endsWith("/audio/speech")) {
    const { audio } = await speak(JSON.parse(bytes.toString() || "{}"));
    res.writeHead(200, { "content-type": "audio/wav", "content-length": audio.length });
    return res.end(audio);
  }
  if (req.method === "GET" && url.endsWith("/models")) {
    return send({ json: { object: "list", data: [{ id: "mock", object: "model", owned_by: "mock-ai" }] } });
  }
  if (req.method === "GET") return send({ json: { status: "ok", mock: true, gallery_size: gallery.size } });
  return send({ status: 404, json: { detail: `mock-ai does not serve ${req.method} ${url}` } });
}

createServer((req, res) => {
  handle(req, res).catch((error) => {
    log("error:", error.message);
    if (!res.headersSent) sendJson(res, 500, { detail: error.message });
    else res.end();
  });
}).listen(PORT, "127.0.0.1", () => {
  log(`mock-ai listening on http://127.0.0.1:${PORT} (face: ${FACE}, heard: ${HEARD.join(" | ")})`);
  reindex().then(() => log(`ocr: ${pageText.size} mock pages indexed`));
});
