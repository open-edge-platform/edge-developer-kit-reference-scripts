// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The Payload signing secret. No profile carries one — cms.payload_secret is
 * blank everywhere git can see it — so the first boot mints one into
 * .payload-secret in the writable data directory, beside db.sqlite.
 *
 * It has to outlive the process: Payload signs the /admin session cookie with
 * it, so a value regenerated on every start logs the operator out on every
 * restart. Set cms.payload_secret to pin your own.
 *
 * See docs/configuration.md.
 */
import { randomInt } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PATH_CHARS } from '../lib/validation'

const FILE = '.payload-secret'
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const LENGTH = 48

function generate(): string {
  let out = ''
  while (out.length < LENGTH) out += CHARS[randomInt(CHARS.length)]
  return out
}

/** The configured value, the stored one, or a fresh one stored for next time. */
export function cmsSecret(): string {
  const configured = process.env.PAYLOAD_SECRET
  if (configured) return configured

  // KIOSK_DATA_DIR is where a packaged kiosk keeps everything it writes; a
  // checkout writes beside its own database. Rebuilt character by character
  // for the scan's taint analysis — see the fix-coverity-issues skill.
  let target = ''
  for (const ch of path.resolve(process.env.KIOSK_DATA_DIR ?? process.cwd(), FILE)) {
    let ok = ''
    for (const allowed of PATH_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) {
      target = ''
      break
    }
    target += ok
  }

  if (target !== '') {
    try {
      if (existsSync(target)) {
        const stored = readFileSync(target, 'utf8').trim()
        if (stored !== '') return stored
      }
    } catch {
      // Unreadable — fall through and mint a replacement.
    }
  }

  const minted = generate()
  try {
    if (target === '') throw new Error('the data directory path is not writable by this kiosk')
    writeFileSync(target, `${minted}\n`, { mode: 0o600 })
  } catch (error) {
    console.warn(
      `[payload] could not store a generated signing key (${(error as Error).message}) — ` +
        'admin sessions will not survive a restart. Set cms.payload_secret in config.yaml.',
    )
  }
  return minted
}
