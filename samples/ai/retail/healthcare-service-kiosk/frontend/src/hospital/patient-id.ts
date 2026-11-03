// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** What a scanned or typed code identifies. Codes carry references only, never personal details. */
export type ScannedCode =
  | { kind: "mrn"; mrn: string }
  | { kind: "appointment"; reference: string; signature: string }
  | { kind: "invalid"; reason: "checksum" | "unknown_format" };

const MRN_PREFIX = "MRN";
const SLIP_PREFIX = "HCKAPT:";

/** Luhn mod-10 check digit over a digit string. */
export function luhnDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/** "MRN" + 7-digit serial + Luhn check digit, e.g. MRN12345674. */
export function formatMrn(serial: number): string {
  const body = String(serial % 10_000_000).padStart(7, "0");
  return `${MRN_PREFIX}${body}${luhnDigit(body)}`;
}

/** The same MRN grouped for reading aloud or off a card: MRN 1234567-4. */
export function displayMrn(mrn: string): string {
  const digits = mrn.replace(/\D/g, "");
  return digits.length === 8 ? `${MRN_PREFIX} ${digits.slice(0, 7)}-${digits.slice(7)}` : mrn;
}

/** Digits of HMAC on an all-digit slip code. */
export const SLIP_SIGNATURE_DIGITS = 13;
const SHORT_SLIP = new RegExp(`^(1\\d{6}|20\\d{5})(\\d{${SLIP_SIGNATURE_DIGITS}})$`);

/** A booked case (HCK-2026-1234) as 1261234, a scheduled visit (APT-12345) as 2012345; null for any other reference. */
export function slipReferenceDigits(reference: string): string | null {
  const booked = /^HCK-20(\d{2})-(\d{4})$/.exec(reference);
  if (booked) return `1${booked[1]}${booked[2]}`;
  const scheduled = /^APT-(\d{5})$/.exec(reference);
  return scheduled ? `20${scheduled[1]}` : null;
}

/**
 * The Code 128 payload on an appointment slip. A reference with a digit form
 * and a digit signature make 20 digits, which Code 128 packs two to a symbol,
 * so the barcode fits across a receipt like the patient card's. Anything else
 * takes the long text form, which scans too.
 */
export function appointmentSlipCode(reference: string, signature: string): string {
  const digits = slipReferenceDigits(reference);
  return digits && /^\d+$/.test(signature) ? `${digits}${signature}` : `${SLIP_PREFIX}${reference}.${signature}`;
}

/** Scanners may prefix an AIM symbology id ("]C0", "]Q1"); people type MRNs with spaces and dashes. */
export function parseScannedCode(raw: string): ScannedCode {
  const text = raw.trim().replace(/^\][A-Za-z]\d/, "").trim();
  if (text.toUpperCase().startsWith(SLIP_PREFIX)) {
    const match = /^([A-Z0-9-]{4,32})\.([A-Z2-7]{16})$/.exec(text.slice(SLIP_PREFIX.length).trim().toUpperCase());
    return match
      ? { kind: "appointment", reference: match[1], signature: match[2] }
      : { kind: "invalid", reason: "unknown_format" };
  }
  const short = SHORT_SLIP.exec(text);
  if (short) {
    const [, ref, signature] = short;
    const reference = ref[0] === "1" ? `HCK-20${ref.slice(1, 3)}-${ref.slice(3)}` : `APT-${ref.slice(2)}`;
    return { kind: "appointment", reference, signature };
  }
  const compact = text.toUpperCase().replace(/[\s-]/g, "");
  const digits = compact.startsWith(MRN_PREFIX) ? compact.slice(MRN_PREFIX.length) : compact;
  if (!/^\d{8}$/.test(digits)) return { kind: "invalid", reason: "unknown_format" };
  if (luhnDigit(digits.slice(0, 7)) !== Number(digits[7])) return { kind: "invalid", reason: "checksum" };
  return { kind: "mrn", mrn: `${MRN_PREFIX}${digits}` };
}
