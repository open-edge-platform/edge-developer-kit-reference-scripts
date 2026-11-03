// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { conflict, delay, notFound, param, unavailable } from "../../_lib/http";
import { moduleOff } from "../../_lib/modules";
import {
  NFC_FAILURE_MESSAGE,
  NfcError,
  readCardUid,
  shouldSimulate,
  takeHandedCard,
  type CardRead,
  type NfcFailure,
} from "../../_lib/nfc";
import { readEnrollmentCard } from "../../_lib/self-enrollment";

/** Simulated wait for the patient to present their MyKad, when none was read. */
const READ_MS = Number(process.env.KIOSK_IDENTITY_READ_MS ?? 2800);

/** One long-poll of `?watch=1`; the page asks again when it comes back empty. */
const WATCH_MS = 25_000;

/**
 * GET — a new patient's MyKad, read to register them (see ../../_lib/self-enrollment).
 *
 * Default: the card the chat's step watch just saw, else the reader, standing
 * a MyKad in when no reader answers — the chat flow and the touch screen's
 * demo button rely on this. `?watch=1`: a real card within one long-poll,
 * never a stand-in, 204 when none comes.
 *
 * 200 is what the card says and the token to register it with; 409 is a card
 * or IC number that already has a record.
 */
export async function GET(req: Request) {
  const off = moduleOff("register");
  if (off) return off;

  if (param(req, "watch") === "1") {
    try {
      return await enrolling(await readCardUid({ timeoutMs: WATCH_MS }));
    } catch (error) {
      if (!(error instanceof NfcError)) throw error;
      if (error.reason === "timeout") return new Response(null, { status: 204 });
      return refusal(error.reason);
    }
  }

  // The chat's step watch saw this card; a tap is off the pad again before this read.
  let card: CardRead | null = takeHandedCard();
  if (!card) {
    try {
      card = await readCardUid();
    } catch (error) {
      if (!(error instanceof NfcError)) throw error;
      if (!shouldSimulate(error.reason)) return refusal(error.reason);
      console.info(`[nfc] standing a MyKad in: ${error.message}`);
      // No reader answered: spend the seconds the peripheral would have.
      await delay(READ_MS);
    }
  }
  return enrolling(card);
}

async function enrolling(card: CardRead | null): Promise<Response> {
  const read = await readEnrollmentCard(card);
  if ("reason" in read) return conflict(read.error, { reason: read.reason });
  return Response.json(read);
}

/** 503 when the reader is the kiosk's problem; 404 when the patient can retry. */
function refusal(reason: NfcFailure): Response {
  const message = NFC_FAILURE_MESSAGE[reason];
  return reason === "timeout" || reason === "read_failed"
    ? notFound(message, { reason })
    : unavailable(message, { reason });
}
