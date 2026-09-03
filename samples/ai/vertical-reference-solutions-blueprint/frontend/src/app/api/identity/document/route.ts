// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { activePack } from "@/packs";
import { delay, notFound, unavailable } from "../../_lib/http";
import { citizenForCard, pickReaderCitizen, type CitizenDoc } from "../../_lib/citizens";
import {
  NFC_FAILURE_MESSAGE,
  NfcError,
  readCardUid,
  shouldSimulate,
  simulatedUid,
  type CardRead,
  type NfcFailure,
} from "../../_lib/nfc";

/** Simulated wait for the citizen to present their card, when none was read. */
const READ_MS = Number(process.env.KIOSK_IDENTITY_READ_MS ?? 2800);

/** Any card opens a record — demo mode for blank cards; off by default. */
const UNKNOWN_CARD_ANY = (process.env.KIOSK_NFC_UNKNOWN_CARD ?? "reject") === "any";

export async function GET() {
  let card: CardRead | null = null;
  try {
    card = await readCardUid();
  } catch (error) {
    if (!(error instanceof NfcError)) throw error;
    if (!shouldSimulate(error.reason)) return refusal(error.reason);
    console.info(`[nfc] standing a citizen in: ${error.message}`);
  }

  if (!card) {
    // No reader answered: spend the seconds the peripheral would have.
    await delay(READ_MS);
    return respond(await pickReaderCitizen(), null);
  }

  const citizen = await citizenForCard(card.uid);
  if (citizen) return respond(citizen, card);
  if (UNKNOWN_CARD_ANY) return respond(await pickReaderCitizen(), card);
  // Deliberately not a reader reason: the UI must not send the citizen back to retry.
  return notFound(
    `card ${card.uid} is not registered to anybody — please see a staff member to have it ` +
      `linked to your record`,
    { reason: "unregistered" },
  );
}

function respond(citizen: CitizenDoc | null, card: CardRead | null): Response {
  if (!citizen) {
    return unavailable("citizen registry is empty — is the CMS reachable?");
  }
  return Response.json({
    documentType: activePack().idDocuments.forCountry(citizen.country),
    documentNumber: citizen.citizenId,
    holderName: citizen.name,
    /** Serial of the card that was read; synthetic for a stood-in read. */
    cardUid: card?.uid ?? simulatedUid(citizen.citizenKey),
    /** True when no reader answered and the kiosk stood a citizen in. */
    simulated: card === null,
    ...(card ? { reader: card.reader } : {}),
    detectedAt: new Date().toISOString(),
  });
}

/** 503 when the reader is the kiosk's problem; 404 when the citizen can retry. */
function refusal(reason: NfcFailure): Response {
  const message = NFC_FAILURE_MESSAGE[reason];
  return reason === "timeout" || reason === "read_failed"
    ? notFound(message, { reason })
    : unavailable(message, { reason });
}
