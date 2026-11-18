// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootEnv = path.resolve(appDirectory, '../..', '.env');
const networkKeys = ['BIND_ADDRESS', 'PORT', 'NEXT_PUBLIC_SERVER_URL'];
const env = { ...process.env };

// Load only network settings: the web workspace owns its database and framework secrets.
if (existsSync(rootEnv)) {
  const configured = JSON.parse(
    execFileSync(
      process.execPath,
      [
        `--env-file=${rootEnv}`,
        '-e',
        `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(networkKeys)}.map(key => [key, process.env[key]]))))`,
      ],
      { encoding: 'utf8' },
    ),
  );
  for (const key of networkKeys) {
    if (env[key] === undefined && configured[key] !== undefined) env[key] = configured[key];
  }
}

const [command, ...args] = process.argv.slice(2);
if (command !== 'start' && command !== 'dev') throw new Error('Expected start or dev.');

function optionValue(long, short, fallback) {
  let value = fallback;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === long || arg === short) value = args[++index];
    else if (arg.startsWith(`${long}=`)) value = arg.slice(long.length + 1);
  }
  return value;
}

env.BIND_ADDRESS = optionValue('--hostname', '-H', env.BIND_ADDRESS ?? '127.0.0.1');
env.PORT = optionValue('--port', '-p', env.PORT ?? '3000');
if (!env.BIND_ADDRESS?.trim()) throw new Error('BIND_ADDRESS must not be empty.');
if (!/^\d+$/.test(env.PORT ?? '') || Number(env.PORT) < 1 || Number(env.PORT) > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const next = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(
  process.execPath,
  [next, command, '--hostname', env.BIND_ADDRESS, '--port', env.PORT, ...args],
  { cwd: appDirectory, env, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error('Could not start Next.js:', error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
});
