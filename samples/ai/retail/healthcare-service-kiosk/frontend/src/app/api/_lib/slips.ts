// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createHmac, timingSafeEqual } from "crypto";
import { appointmentSlipCode, SLIP_SIGNATURE_DIGITS, slipReferenceDigits } from "@/hospital/patient-id";
import { cmsSecret } from "@/payload/secret";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

const slipMac = (reference: string) => createHmac("sha256", cmsSecret()).update(`slip:${reference}`).digest();

/** 80 bits of HMAC: a slip cannot be forged from a guessed case id, only scanned off a real one. */
function slipSignature(reference: string): string {
  return base32(slipMac(reference)).slice(0, 16);
}

/** The same HMAC as 13 digits (about 43 bits) for the all-digit code: still far past guessing at a kiosk. */
function slipDigits(reference: string): string {
  return String(slipMac(reference).readUIntBE(0, 6) % 10 ** SLIP_SIGNATURE_DIGITS).padStart(SLIP_SIGNATURE_DIGITS, "0");
}

export function signedSlipCode(reference: string): string {
  return appointmentSlipCode(reference, slipReferenceDigits(reference) ? slipDigits(reference) : slipSignature(reference));
}

export function slipSignatureValid(reference: string, signature: string): boolean {
  const expected = Buffer.from(/^\d+$/.test(signature) ? slipDigits(reference) : slipSignature(reference));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
