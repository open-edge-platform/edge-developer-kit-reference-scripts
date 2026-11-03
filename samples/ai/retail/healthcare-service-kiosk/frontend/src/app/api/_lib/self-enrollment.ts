// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from "node:crypto";
import { detectFaces, faceServiceConfigured } from "@/lib/face-service";
import {
  chipLines,
  readChip,
  type ChipDetails,
} from "@/packs/malaysia/services/patient-registration/new-patient/create-patient-record/mykad-chip";
import { CmsError, cmsDelete } from "./cms";
import { ageOn, citizenForCard, findCitizenByDocument, type CitizenDoc } from "./citizens";
import { cardHolder, checkBirthDate, checkUid, createCitizen, nextCitizenKey, storePortrait, type PortraitDoc } from "./enrollment";
import type { CardRead } from "./nfc";

/**
 * A new patient registering themselves at the kiosk.
 *
 * The registration desk's two bindings (see ./enrollment), made by the
 * patient instead of by staff: their MyKad is read, they confirm what it
 * says, and the record is created with their photo and the card's serial —
 * so the next time they tap that card, it opens their record and the camera
 * has a face to match.
 *
 * What the card said is held here, server-side, between the read and the
 * photo. The patient only ever sees it and answers yes or no: nothing they
 * send can change the name or IC number a record is created under.
 */

/** Long enough to read the details and stand for a photo; a read older than this belonged to someone who left. */
const TTL_MS = 10 * 60_000;

type Held = { details: ChipDetails; nfcUid: string | null; at: number };

const PENDING = Symbol.for("kiosk.selfEnrollment.pending");
type Global = { [PENDING]?: Map<string, Held> };

function pending(): Map<string, Held> {
  const globals = globalThis as Global;
  const held = (globals[PENDING] ??= new Map());
  const now = Date.now();
  for (const [token, entry] of held) if (now - entry.at > TTL_MS) held.delete(token);
  return held;
}

/** What the card says, for the patient to confirm. `token` names it for the photo that follows. */
export type CardEnrollment = {
  token: string;
  details: ChipDetails;
  /** The read-back to put to the patient, IC number masked. */
  lines: { label: string; value: string }[];
  /** No reader answered: a stand-in MyKad was read, and there is no card to bind. */
  simulated: boolean;
};

export { SEE_THE_COUNTER } from "@/packs/malaysia/services/patient-registration/new-patient/create-patient-record/registered";

export type EnrollmentFailure = {
  reason: "registered" | "expired" | "no_face" | "several_faces";
  /** Written for the patient at the screen. */
  error: string;
};

/** Says nothing about whose record it is: the card on the reader may not be the person's at the screen. */
const REGISTERED: EnrollmentFailure = {
  reason: "registered",
  error:
    "This MyKad is already registered with us, so there's no need to register again. Tap it to sign in " +
    "for any service, or use Patient Verification to check your details.",
};

/**
 * Read `card` as a new patient's MyKad, or a stand-in one when it is null.
 *
 * Refused when the card already opens a record, or its IC number is already
 * registered: that person needs Patient Verification, not a second record.
 */
export async function readEnrollmentCard(card: CardRead | null): Promise<CardEnrollment | EnrollmentFailure> {
  const holder = card ? await citizenForCard(card.uid) : null;
  if (holder) return REGISTERED;

  const details = readChip(card?.uid ?? randomBytes(7).toString("hex"));
  const known = await findCitizenByDocument(details.idNumber);
  if (known) return REGISTERED;

  // Only a serial binds: an ATR names a card model, and a stand-in names no card at all.
  const checked = card && !card.fromAtr ? checkUid(card.uid) : null;
  const token = crypto.randomUUID();
  pending().set(token, { details, nfcUid: checked && "uid" in checked ? checked.uid : null, at: Date.now() });
  return { token, details, lines: chipLines(details), simulated: card === null };
}

/** The patient said the details are not theirs: forget them. */
export function discardEnrollment(token: string): void {
  pending().delete(token);
}

/**
 * Create the record the confirmed card read describes, with `frame` as its
 * portrait — or without one when the kiosk had no camera, which the counter
 * then takes.
 *
 * A photo the face detector cannot use is refused and the read kept, so the
 * patient can simply stand for it again.
 */
export async function completeEnrollment(
  token: string,
  frame: Uint8Array | null,
): Promise<{ citizen: CitizenDoc; portrait: boolean } | EnrollmentFailure> {
  const held = pending().get(token);
  if (!held) {
    return { reason: "expired", error: "That card read has expired — please tap your MyKad on the reader again." };
  }
  const { details, nfcUid } = held;

  // Re-checked: another kiosk may have registered this IC, or bound this card, since the read.
  const known = (await findCitizenByDocument(details.idNumber)) ?? (nfcUid ? await cardHolder(nfcUid) : null);
  if (known) {
    pending().delete(token);
    return REGISTERED;
  }

  const unusable = frame ? await unusablePhoto(frame) : null;
  if (unusable) return unusable;

  let portrait: PortraitDoc | null = null;
  try {
    if (frame) {
      portrait = await storePortrait(new File([new Uint8Array(frame)], "portrait.jpg", { type: "image/jpeg" }), details.name);
    }
  } catch (error) {
    // The upload's own detector disagreed with ours: the same answer for the patient.
    if (error instanceof CmsError && error.status === 400) return NO_FACE;
    throw error;
  }

  const birth = checkBirthDate(details.dateOfBirth);
  const [year, month, day] = details.dateOfBirth.split("-").map(Number);
  try {
    const citizen = await createCitizen({
      citizenKey: await nextCitizenKey(),
      citizenId: details.idNumber,
      name: details.name,
      country: details.country,
      address: details.address,
      nfcUid,
      ...(portrait ? { faceImage: portrait.id } : {}),
      ...("iso" in birth ? { dateOfBirth: birth.iso } : {}),
      age: ageOn({ year, month: month - 1, day }),
      sex: details.sex,
      notes: "Registered themselves at the kiosk.",
    });
    pending().delete(token);
    return { citizen, portrait: portrait !== null };
  } catch (error) {
    // A portrait of somebody who never got a record is not one to keep. Deleting is
    // otherwise an admin's (see ./enrollment), but this is the kiosk's own upload of a
    // moment ago, and nobody else will know it is there.
    if (portrait) {
      const orphan = portrait;
      await cmsDelete("face-photos", orphan.id).catch(() =>
        console.warn(`[enroll] ${orphan.filename} is a portrait with no citizen — delete it in the CMS (Face Photos).`),
      );
    }
    throw error;
  }
}

const NO_FACE: EnrollmentFailure = {
  reason: "no_face",
  error: "We couldn't see your face clearly. Look straight at the camera, with nothing covering your face, and we'll try again.",
};

/** Checked before anything is stored, so the patient hears why in their own terms rather than an upload error's. */
async function unusablePhoto(frame: Uint8Array): Promise<EnrollmentFailure | null> {
  if (!faceServiceConfigured()) return null;
  let faces: number;
  try {
    faces = await detectFaces(frame, "image/jpeg");
  } catch (error) {
    // Advisory, as the face-photos upload is: a check that could not run is not a bad photo.
    console.warn(`[enroll] could not check the photo for a face: ${(error as Error).message}`);
    return null;
  }
  if (faces === 0) return NO_FACE;
  if (faces > 1) {
    return {
      reason: "several_faces",
      error: "There's more than one face in the photo. Please ask anyone with you to step out of view, and we'll try again.",
    };
  }
  return null;
}
