// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, appendFile, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(scriptsDirectory, '..');
const envPath = path.join(appDirectory, '.env');
const examplePath = path.join(appDirectory, '.env.example');
const rootEnvPath = path.resolve(appDirectory, '../..', '.env');
// Keys the app cannot start without; missing ones are copied from .env.example.
const requiredKeys = ['ROBOTIC_STUDIO_DATA_DIR'];

function assignments(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (match) values.set(match[1], line.trim());
  }
  return values;
}

function assignmentValue(values, key) {
  const assignment = values.get(key);
  return assignment ? assignment.slice(assignment.indexOf('=') + 1).trim() : '';
}

function upsertAssignment(text, key, value) {
  const lines = text.split('\n');
  const index = lines.findIndex((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith(key) && trimmed.slice(key.length).trimStart().startsWith('=');
  });
  if (index >= 0) {
    lines[index] = `${key}=${value}${lines[index].endsWith('\r') ? '\r' : ''}`;
    return lines.join('\n');
  }

  const separator = text.length === 0 || text.endsWith('\n') ? '' : '\n';
  return `${text}${separator}${key}=${value}\n`;
}

function localDatabaseUri(rootValues) {
  const password = assignmentValue(rootValues, 'POSTGRES_PASSWORD');
  if (!password) return '';

  const user = assignmentValue(rootValues, 'POSTGRES_USER') || 'postgres';
  const port = assignmentValue(rootValues, 'POSTGRES_PORT') || '5432';
  const database = assignmentValue(rootValues, 'POSTGRES_DB') || 'mujoco_studio';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@localhost:${port}/${encodeURIComponent(database)}`;
}

try {
  await access(envPath);
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  try {
    await copyFile(examplePath, envPath, constants.COPYFILE_EXCL);
    console.log('Created apps/web/.env from apps/web/.env.example.');
  } catch (copyError) {
    if (!(copyError instanceof Error && 'code' in copyError && copyError.code === 'EEXIST')) {
      throw copyError;
    }
  }
}

const current = assignments(await readFile(envPath, 'utf8'));
const example = assignments(await readFile(examplePath, 'utf8'));
const missing = requiredKeys.filter((key) => !current.has(key) && example.has(key));
if (missing.length > 0) {
  const existing = await readFile(envPath, 'utf8');
  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  await appendFile(envPath, `${separator}${missing.map((key) => example.get(key)).join('\n')}\n`);
  console.log(`Added ${missing.join(', ')} to apps/web/.env from apps/web/.env.example.`);
}

let rootEnv = '';
try {
  rootEnv = await readFile(rootEnvPath, 'utf8');
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}

const rootValues = assignments(rootEnv);
const databaseUri = localDatabaseUri(rootValues);
const currentDatabaseUri = assignmentValue(current, 'DATABASE_URI');
const exampleDatabaseUri = assignmentValue(example, 'DATABASE_URI');
const syncDatabaseUri = process.argv.includes('--sync-database');

if (
  databaseUri &&
  (syncDatabaseUri || !currentDatabaseUri || currentDatabaseUri === exampleDatabaseUri)
) {
  const existing = await readFile(envPath, 'utf8');
  const updated = upsertAssignment(existing, 'DATABASE_URI', databaseUri);
  if (updated !== existing) {
    await writeFile(envPath, updated);
    console.log('Synchronized DATABASE_URI in apps/web/.env with the root PostgreSQL settings.');
  }
}

if (!assignmentValue(current, 'PAYLOAD_SECRET')) {
  const existing = await readFile(envPath, 'utf8');
  const secret = randomBytes(32).toString('base64url');
  await writeFile(envPath, upsertAssignment(existing, 'PAYLOAD_SECRET', secret));
  console.log('Generated PAYLOAD_SECRET in apps/web/.env.');
}
