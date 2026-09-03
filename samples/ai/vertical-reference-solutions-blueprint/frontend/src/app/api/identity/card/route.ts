// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { notFound, param, unavailable } from "../../_lib/http";
import { citizenForCard } from "../../_lib/citizens";
import {
  NFC_FAILURE_MESSAGE,
  NfcError,
  nfcReaders,
  nfcSimulatedAlways,
  readCardUid,
} from "../../_lib/nfc";

/** How long this route waits for a tap when the caller doesn't say (ms). */
const DEFAULT_WAIT_MS = 15_000;

/**
 * What is on the card reader right now — the serial, and who it opens.
 *
 * This is the bench route for the ID reader: hit it, tap a card, read its
 * serial off the reply, paste that into the CMS (Citizens -> NFC card serial)
 * or into `nfc.cards:` in config.yaml. `npm run nfc:probe` does the same job
 * from a terminal; this one works while the kiosk is running and answers over
 * the network, which is what you want on an installed machine.
 *
 *   GET /api/identity/card              wait up to 15s for a tap
 *   GET /api/identity/card?timeout=0    what is on the reader right now
 *   GET /api/identity/card?timeout=60000
 *
 * It is deliberately NOT /api/identity/document with extra fields. That route
 * is the identity step and stands a citizen in when no reader answers, which
 * is exactly the behaviour you are trying to see past when you are testing a
 * reader. Nothing here is ever simulated: no reader means an error saying so.
 */
export async function GET(req: Request) {
  if (nfcSimulatedAlways()) {
    return unavailable(
      "the card reader is switched off (nfc.simulate: always) — this route only reads real " +
        "hardware, so set simulate to auto or never to use it",
    );
  }

  const asked = param(req, "timeout");
  const timeoutMs = /^\d+$/.test(asked) ? Number(asked) : DEFAULT_WAIT_MS;

  try {
    const card = await readCardUid({ timeoutMs });
    const citizen = await citizenForCard(card.uid);
    return Response.json({
      readers: await readers(),
      card,
      /** The registry record this card opens, or null if nothing claims it. */
      boundTo: citizen
        ? { citizenKey: citizen.citizenKey, citizenId: citizen.citizenId, name: citizen.name }
        : null,
      ...(citizen ? {} : { bind: bindHint(card.uid, card.fromAtr) }),
    });
  } catch (error) {
    if (!(error instanceof NfcError)) throw error;
    const body = {
      error: NFC_FAILURE_MESSAGE[error.reason],
      reason: error.reason,
      /** The reader's own words, which say more than the citizen-facing line. */
      detail: error.message,
      readers: await readers(),
    };
    // Same split the identity step draws: a missing or broken reader is the
    // kiosk's problem, a reader that saw no usable card is one to retry.
    const status = error.reason === "timeout" || error.reason === "read_failed" ? 404 : 503;
    return Response.json(body, { status });
  }
}

/** Readers currently connected, or none when they cannot be asked. */
const readers = (): Promise<string[]> => nfcReaders().catch(() => []);

/** How to bind a card that no record claims yet. */
function bindHint(uid: string, fromAtr: boolean): string {
  if (fromAtr) {
    return (
      "This card did not answer the serial APDU, so the value above is its ATR — which identifies a card MODEL, not a card. Every card of this type reads the same, so do not bind it to a citizen."
    );
  }
  return (
    `No citizen record claims ${uid}. Bind it in the CMS admin (Citizens -> NFC card serial), ` +
    `or map it under "nfc: cards:" in config.yaml — the serial above as the key, a CitizenKey ` +
    `or citizen ID as the value.`
  );
}
