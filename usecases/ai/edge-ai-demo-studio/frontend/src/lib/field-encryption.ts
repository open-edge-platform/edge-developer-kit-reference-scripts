// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * AES-256-GCM field-level encryption for sensitive values stored in the DB.
 *
 * Wire format: `v1:<base64(iv[12] || authTag[16] || ciphertext)>`
 *
 * Key derivation: HKDF-SHA256 from PAYLOAD_SECRET with a fixed, purpose-specific
 * info string so the derived key is domain-separated from any other key material.
 */

import crypto from 'node:crypto'

const HKDF_SALT = 'demo-studio-field-encryption-salt'
const HKDF_INFO = 'demo-studio:hfToken:v1'
const VERSION_PREFIX = 'v1:'

function getDerivedKey(): Buffer {
  const secret = process.env.PAYLOAD_SECRET
  if (!secret) {
    throw new Error(
      'PAYLOAD_SECRET env var is not set — cannot encrypt/decrypt field values.',
    )
  }
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(secret),
      Buffer.from(HKDF_SALT),
      Buffer.from(HKDF_INFO),
      32,
    ),
  )
}

export function encryptField(plaintext: string): string {
  if (!plaintext) return plaintext
  // Guard: never double-encrypt an already-encrypted value.
  if (plaintext.startsWith(VERSION_PREFIX)) return plaintext

  const key = getDerivedKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  const bundle = Buffer.concat([iv, authTag, encrypted])
  return `${VERSION_PREFIX}${bundle.toString('base64')}`
}

export function decryptField(stored: string): string {
  if (!stored) return stored
  if (!stored.startsWith(VERSION_PREFIX)) {
    // Legacy plaintext value — return as-is.
    return stored
  }

  const key = getDerivedKey()
  const bundle = Buffer.from(stored.slice(VERSION_PREFIX.length), 'base64')

  if (bundle.length < 28) {
    // 12 (iv) + 16 (tag) minimum; anything shorter is corrupt.
    throw new Error('Encrypted field value is corrupt or truncated.')
  }

  const iv = bundle.subarray(0, 12)
  const authTag = bundle.subarray(12, 28)
  const ciphertext = bundle.subarray(28)

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8')
}
