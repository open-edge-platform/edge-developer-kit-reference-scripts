// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cmsCreate, cmsDeleteAs, cmsFind, cmsFindOne, cmsUpdate, cmsUpload } from "./cms";
import { normalizeUid, type CitizenDoc } from "./citizens";

/**
 * Enrolling a citizen: the registry writes behind the registration desk.
 *
 * Two things are being bound here, and they are the two the kiosk later
 * trusts to say who somebody is — the portrait the camera is matched against,
 * and the serial of the card that opens their record. Everything in this
 * module exists to keep those bindings honest:
 *
 * - a card serial belongs to exactly one citizen, so a serial another record
 *   already claims is refused rather than moved;
 * - a serial has to be a serial — a stood-in read (`MOCK…`) and a contact
 *   card's ATR both identify a *kind* of card rather than a card, and binding
 *   either would open one citizen's record to every card like it;
 * - a portrait is uploaded before the citizen row is written and removed
 *   again if that write fails, so a rejected enrollment leaves no orphan
 *   photograph of somebody who was never registered.
 *
 * The face-photos collection does its own checking: it refuses a picture the
 * face detector cannot find exactly one face in (see FacePhotos), and that
 * refusal arrives here as a CmsError whose message is written for the person
 * standing at the desk.
 */

/** Formats the face worker can decode, mirroring the upload collection. */
const PORTRAIT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PORTRAIT_BYTES = Number(process.env.KIOSK_PORTRAIT_MAX_BYTES ?? 8 * 1024 * 1024);

/** A face-photos row, as much of it as the desk needs. */
export type PortraitDoc = { id: number; filename: string; alt?: string | null };

/** Why a card serial cannot be bound, phrased for the staff member. */
export type UidRejection = { error: string };

/**
 * Check a card serial before it is written to a record.
 *
 * Serials are compared as bare uppercase hex however they were typed, so the
 * value this returns — not the one that was typed — is the one to store.
 */
export function checkUid(raw: string): { uid: string } | UidRejection {
  const uid = normalizeUid(raw);
  if (!uid) return { error: "enter a card serial, or read one off the reader" };
  if (uid.startsWith("MOCK")) {
    return {
      error:
        "that is a stand-in serial from a simulated read, not a real card. Tap the card on " +
        "the reader with nfc.simulate set to auto or never to read its own serial.",
    };
  }
  if (!/^[0-9A-F]+$/.test(uid)) {
    return { error: "a card serial is hex — digits and A–F only, e.g. 04A2B3C4D5E6" };
  }
  // 4 bytes is the shortest serial any contactless card carries; 7 and 10 are
  // the other two sizes. Anything shorter is a mistyped one.
  if (uid.length < 8) return { error: `${uid} is too short to be a card serial` };
  return { uid };
}

/** The citizen already holding this serial, ignoring `exceptId`. */
export async function cardHolder(
  uid: string,
  exceptId?: number,
): Promise<CitizenDoc | null> {
  const held = await cmsFindOne<CitizenDoc>("citizens", { nfcUid: { equals: uid } });
  return held && held.id !== exceptId ? held : null;
}

/**
 * The next free registry key.
 *
 * `citizenKey` is the row number the seed data came in on, and everything
 * derived for a citizen — their plate, their summons numbers, their birthday
 * — is generated from it, so a new citizen needs one of their own rather than
 * a repeat. Highest-plus-one: the desk is the only thing issuing them, and
 * reusing a gap would hand a new citizen the derived data of a deleted one.
 */
export async function nextCitizenKey(): Promise<number> {
  const top = await cmsFind<CitizenDoc>("citizens", { limit: 1, sort: "-citizenKey" });
  return (top.docs[0]?.citizenKey ?? 0) + 1;
}

/** Reject a portrait the face pipeline could not use, before uploading it. */
export function checkPortrait(file: File): UidRejection | null {
  if (!PORTRAIT_TYPES.includes(file.type)) {
    return { error: "a portrait must be a JPEG, PNG or WebP image" };
  }
  if (file.size > MAX_PORTRAIT_BYTES) {
    return {
      error: `portrait is too large — maximum ${Math.round(MAX_PORTRAIT_BYTES / 1024 / 1024)} MB`,
    };
  }
  return null;
}

/**
 * Upload a portrait to the face-photos collection.
 *
 * Named after the citizen and stamped, because the filename is what an admin
 * sees in the photo picker and "citizen.jpg" from a webcam capture tells them
 * nothing about whose face it is.
 */
export async function storePortrait(file: File, name: string): Promise<PortraitDoc> {
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return cmsUpload<PortraitDoc>(
    "face-photos",
    {
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: `${slug || "citizen"}-${Date.now()}.${extension}`,
      mimeType: file.type,
    },
    { alt: name.trim() },
  );
}

/**
 * Drop a portrait that was uploaded for a record which then failed to save.
 *
 * On the staff member's own session: only a logged-in admin may delete from
 * the registry, and the kiosk key this module writes with is refused here by
 * design. A cleanup that cannot run is reported rather than hidden — the
 * picture is then sitting in the CMS with no citizen attached, and somebody
 * has to know to remove it.
 */
export async function discardPortrait(
  portrait: PortraitDoc | null,
  cookie: string,
): Promise<void> {
  if (!portrait) return;
  const removed = await cmsDeleteAs("face-photos", portrait.id, cookie);
  if (!removed) {
    console.warn(
      `[enroll] ${portrait.filename} was uploaded for a citizen that could not be saved, ` +
        "and could not be removed again — delete it by hand in the CMS (Face Photos).",
    );
  }
}

/** Bind a portrait and/or a card to a citizen that already exists. */
export function updateCitizenEnrollment(
  id: number,
  changes: { nfcUid?: string | null; faceImage?: number },
): Promise<CitizenDoc> {
  return cmsUpdate<CitizenDoc>("citizens", id, changes);
}

export function createCitizen(data: Record<string, unknown>): Promise<CitizenDoc> {
  return cmsCreate<CitizenDoc>("citizens", data);
}
