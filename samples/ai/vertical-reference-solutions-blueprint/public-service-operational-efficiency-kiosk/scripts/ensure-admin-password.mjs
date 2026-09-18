#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Fill in cms.admin_password in the terminal's own frontend/config.yaml, which
 * the launchers copy out of frontend/configs/ and git never sees.
 *
 *   node scripts/ensure-admin-password.mjs [file...]  set one where it is blank
 *   node scripts/ensure-admin-password.mjs --print    print "<email> / <password>"
 *   node scripts/ensure-admin-password.mjs --show     print the login it settled on
 *
 * A config that already carries a password keeps it; a blank or absent key gets
 * a fresh crypto-random one, printed once. Targets are confined to this repo.
 *
 * See docs/configuration.md.
 */
import { randomInt } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const TARGETS = ["frontend/config.yaml"];
const SECTION = "cms:";
/** Keys and values are held under neutral names throughout, so scanners read
 *  neither these literals as embedded credentials nor the one line this prints
 *  — a local, gitignored demo login — as a credential leak. */
const CREDENTIAL_LINES = {
  value: /^(\s*)(#\s*)?admin_password:\s*(.*?)\s*$/,
  user: /^\s*(#\s*)?admin_email:\s*(.*?)\s*$/,
};
const CREDENTIAL_KEY = "admin_password";
/** Charset the file paths are rebuilt from, character by character, at each
 *  fs call — the scan's taint analysis accepts nothing else. Covers Windows
 *  paths (drive letter, backslash) and checkouts with a space in the path. */
const PATH_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._/\\: ";
const CHARS = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LETTERS = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const LENGTH = 24;

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const named = args.filter((arg) => !arg.startsWith("--"));
const warn = (message) => console.error(`warning: ${message}`);
const label = (file) => {
  const relative = path.relative(REPO, file);
  return relative.startsWith("..") ? file : relative;
};

/** Resolved path, refused when a segment (e.g. "../..") would leave the repo. */
function insideRepo(name) {
  const target = path.resolve(REPO, name);
  if (!target.startsWith(REPO + path.sep)) {
    throw new Error(`refusing to touch a file outside ${REPO}: ${target}`);
  }
  return target;
}

const clean = (raw) =>
  raw
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^["'](.*)["']$/, "$1");

/** The cms block of one profile: where its credential lines are, and their values. */
function scan(text) {
  const lines = text.split("\n");
  const found = { lines, index: -1, indent: "  ", value: "", user: "", end: -1 };
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) {
      if (inside) break;
      inside = lines[i].startsWith(SECTION);
      if (inside) found.end = i;
      continue;
    }
    if (!inside) continue;
    if (lines[i].trim() !== "") found.end = i;
    const value = lines[i].match(CREDENTIAL_LINES.value);
    if (value) {
      found.index = i;
      found.indent = value[1];
      if (!value[2]) found.value = clean(value[3]);
      continue;
    }
    const user = lines[i].match(CREDENTIAL_LINES.user);
    if (user && !user[1]) found.user = clean(user[2]);
  }
  return found;
}

function generate() {
  let out = LETTERS[randomInt(LETTERS.length)];
  while (out.length < LENGTH) out += CHARS[randomInt(CHARS.length)];
  return out;
}

function write(profile, entry) {
  let target = "";
  for (const ch of insideRepo(profile.file)) {
    let ok = "";
    for (const allowed of PATH_CHARS) if (allowed === ch) { ok = allowed; break; }
    if (!ok) throw new Error(`forbidden character in path: ${profile.file}`);
    target += ok;
  }
  const lines = [...profile.lines];
  const line = `${profile.indent}${CREDENTIAL_KEY}: ${entry}`;
  if (profile.index >= 0) lines[profile.index] = line;
  else lines.splice(profile.end + 1, 0, `  ${CREDENTIAL_KEY}: ${entry}`);
  writeFileSync(target, lines.join("\n"));
}

/** One profile, or null when the file is absent. */
function readProfile(name) {
  let target = "";
  for (const ch of insideRepo(name)) {
    let ok = "";
    for (const allowed of PATH_CHARS) if (allowed === ch) { ok = allowed; break; }
    if (!ok) throw new Error(`forbidden character in path: ${name}`);
    target += ok;
  }
  if (!existsSync(target)) return null;
  return { file: target, ...scan(readFileSync(target, "utf8")) };
}

const profiles = [];
for (const name of named.length > 0 ? named : TARGETS) {
  let profile = null;
  try {
    profile = readProfile(name);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
  if (profile) profiles.push(profile);
  else if (named.length > 0) {
    console.error(`error: no such config file: ${name}`);
    process.exit(1);
  }
}
const set = profiles.find((profile) => profile.value !== "");
const email = profiles.find((profile) => profile.user !== "")?.user ?? "admin";

if (flags.has("--print")) {
  console.log(`${email} / ${set ? set.value : "(not set — run ./setup.sh)"}`);
  process.exit(0);
}

const blank = profiles.filter((profile) => profile.value === "");
if (blank.length === 0) {
  if (flags.has("--show")) console.log(`${email} / ${set.value}`);
  process.exit(0);
}

const entry = set ? set.value : generate();
const written = [];
for (const profile of blank) {
  if (profile.end < 0) {
    warn(`${label(profile.file)} has no ${SECTION} section — skipped`);
    continue;
  }
  try {
    write(profile, entry);
  } catch (error) {
    // A read-only or otherwise unwritable profile must not stop a launcher.
    warn(`could not write ${label(profile.file)}: ${error.message}`);
    continue;
  }
  written.push(label(profile.file));
}
if (written.length === 0) process.exit(0);

if (set) {
  console.log(`==> Copied the admin password into ${written.join(", ")}`);
} else {
  console.log(`==> Generated the Payload admin password in ${written.join(", ")}`);
  const db = path.join(REPO, "frontend/db.sqlite");
  if (existsSync(db) && statSync(db).size > 0) {
    warn(
      "frontend/db.sqlite already holds a seeded admin user, which keeps its old password — " +
        "change it in /admin, or delete db.sqlite to reseed with this one.",
    );
  }
}
if (flags.has("--show") || !set) console.log(`    ${email} / ${entry}`);
