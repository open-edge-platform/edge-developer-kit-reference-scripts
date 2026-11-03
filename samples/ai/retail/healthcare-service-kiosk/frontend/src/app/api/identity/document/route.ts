// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { activePack } from "@/packs";
import { displayMrn } from "@/hospital/patient-id";
import { takePendingCode, waitForCode } from "../../_lib/barcode";
import { delay, notFound, param, unavailable } from "../../_lib/http";
import { takePaperIdentity, waitForPaperIdentity, type PaperIdentity } from "../../_lib/identity-paper";
import { citizenForCard, findCitizenByDocument, pickReaderCitizen, type CitizenDoc } from "../../_lib/citizens";
import {
  NFC_FAILURE_MESSAGE,
  NfcError,
  readCardUid,
  shouldSimulate,
  simulatedUid,
  takeHandedCard,
  type CardRead,
  type NfcFailure,
} from "../../_lib/nfc";
import { resolveScan, type ScanResolution } from "../../_lib/patients";
import { waitForTappedCard } from "../../_lib/simulated-card";

/** Simulated wait for the citizen to present their card, when none was read. */
const READ_MS = Number(process.env.KIOSK_IDENTITY_READ_MS ?? 2800);

/** Any card opens a record — demo mode for blank cards; off by default. */
const UNKNOWN_CARD_ANY = (process.env.KIOSK_NFC_UNKNOWN_CARD ?? "reject") === "any";

/** One long-poll of `?watch=1`; the page asks again when it comes back empty. */
const WATCH_MS = 25_000;

/**
 * GET — the identity document in front of the kiosk.
 *
 * Default: a page or code read moments ago, else the card reader, standing a
 * citizen in when no reader answers (the chat flow and the card bench rely on
 * this). `?watch=1`: whichever comes first of a real card, a scan or a page
 * read at /api/identity/paper, never a stand-in, 204 when none arrives — the
 * touch screen offers its own simulated choices.
 */
export async function GET(req: Request) {
  if (param(req, "watch") === "1") return watch(req.signal);

  const paper = takePaperIdentity();
  if (paper) return fromPaper(paper);
  const pending = takePendingCode();
  if (pending) return scanned(await resolveScan(pending));
  // The chat's step watch saw this card; a tap is off the pad again before this read.
  const handed = takeHandedCard();
  if (handed) return fromCard(handed);

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
  return fromCard(card);
}

async function watch(signal: AbortSignal): Promise<Response> {
  const stop = new AbortController();
  signal.addEventListener("abort", () => stop.abort(), { once: true });
  const scan = waitForCode(WATCH_MS, stop.signal).then((code) => (code ? { code } : null));
  // A card staff tapped from /mock-documents counts as one presented here.
  const tap = waitForTappedCard(WATCH_MS, stop.signal).then((citizenId) => (citizenId ? { citizenId } : null));
  const paper = waitForPaperIdentity(WATCH_MS, stop.signal).then((page) => (page ? { page } : null));
  const card = readCardUid({ timeoutMs: WATCH_MS })
    .then((read) => ({ read }))
    // No reader, or none fitted: the scanners and the staff bench decide this poll.
    .catch(() => Promise.race([scan, tap, paper]));
  const first = await Promise.race([scan, tap, paper, card]);
  stop.abort();
  if (!first) return new Response(null, { status: 204 });
  if ("page" in first) return fromPaper(first.page);
  if ("code" in first) return scanned(await resolveScan(first.code));
  if ("citizenId" in first) return respond(await findCitizenByDocument(first.citizenId), null);
  return fromCard(first.read);
}

async function fromCard(card: CardRead): Promise<Response> {
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

/** An ID number gets the face check: a MyKad number carries the date of birth. */
async function fromPaper(page: PaperIdentity): Promise<Response> {
  if (page.kind === "mrn") return scanned(await resolveScan(page.mrn), page);
  return respond(await findCitizenByDocument(page.citizenId), null, page);
}

function respond(citizen: CitizenDoc | null, card: CardRead | null, page?: PaperIdentity): Response {
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
    simulated: page ? page.simulated : card === null,
    ...(card ? { reader: card.reader } : {}),
    ...(page ? { via: "paper" } : {}),
    secondFactor: "face",
    detectedAt: new Date().toISOString(),
  });
}

/** A scan only finds the record: nothing naming the patient goes out until they confirm their date of birth. */
function scanned(resolved: ScanResolution, page?: PaperIdentity): Response {
  if (!resolved.ok) return notFound("We couldn't match that code to a patient record.", { reason: "unregistered" });
  return Response.json({
    documentType: resolved.kind,
    documentNumber: resolved.citizen.citizenId,
    holderName: "",
    cardUid: "",
    simulated: page?.simulated ?? false,
    ...(page ? { via: "paper" } : {}),
    secondFactor: "dob",
    mrnHint: displayMrn(resolved.mrn).slice(-4),
    ...(resolved.kind === "appointmentSlip" ? { appointmentReference: resolved.appointment.reference } : {}),
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
