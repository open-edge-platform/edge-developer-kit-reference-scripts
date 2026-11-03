// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { activePack } from "@/packs";
import { cmsFind, cmsFindOne, cmsUpdate } from "./cms";
import type { FacePhotoRef } from "./face";
import { randomInt } from "./random";
import { takeTappedCard } from "./simulated-card";

export type CitizenDoc = {
  id: number;
  citizenKey: number;
  citizenId: string;
  /** Card serial as uppercase hex (as ./nfc reads it); null when no card is bound. */
  nfcUid?: string | null;
  name: string;
  /** One of the active country pack's `countries` (see src/lib/countries). */
  country: string;
  /** Face-check portrait: bare row id at depth 0, photo record at depth 1; null makes the face check fail. */
  faceImage?: FacePhotoRef;
  /** ISO timestamp from the CMS date field; null on seeded patients (see birthDate). */
  dateOfBirth?: string | null;
  sex?: "female" | "male" | null;
  age?: number | null;
  phone?: string | null;
  email?: string | null;
  allergies?: string | null;
  emergencyContact?: { name?: string | null; relationship?: string | null; phone?: string | null } | null;
  address: { line: string; city: string; postcode: string };
};

export function findCitizenByDocument(
  documentNumber: string,
  opts: { depth?: number } = {},
): Promise<CitizenDoc | null> {
  return cmsFindOne<CitizenDoc>(
    "citizens",
    { citizenId: { equals: documentNumber.trim().toUpperCase() } },
    opts,
  );
}

/** Cards bound in config.yaml (`nfc.cards:`) as "UID=citizen;UID=citizen",
 *  where each citizen is a citizen ID (MY3080592042) or a CitizenKey. */
function configuredCards(): Map<string, string> {
  return new Map(
    (process.env.KIOSK_NFC_CARDS ?? "")
      .split(";")
      .map((entry) => entry.split("="))
      .filter((pair): pair is [string, string] => pair.length === 2 && Boolean(pair[1]?.trim()))
      .map(([uid, citizen]) => [normalizeUid(uid), citizen.trim()]),
  );
}

export const normalizeUid = (uid: string): string =>
  uid.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();

/** The citizen a card serial belongs to, or null if no record claims it. */
export async function citizenForCard(
  uid: string,
  opts: { depth?: number } = {},
): Promise<CitizenDoc | null> {
  const serial = normalizeUid(uid);
  if (!serial) return null;

  const configured = configuredCards().get(serial);
  if (configured) {
    return cmsFindOne<CitizenDoc>(
      "citizens",
      /^\d+$/.test(configured)
        ? { citizenKey: { equals: Number(configured) } }
        : { citizenId: { equals: configured.toUpperCase() } },
      opts,
    );
  }
  return cmsFindOne<CitizenDoc>("citizens", { nfcUid: { equals: serial } }, opts);
}

/** The citizen a stood-in read reports: a card staff tapped from
 *  /mock-documents, else the one pinned via KIOSK_READER_CITIZEN (citizen ID
 *  or CitizenKey), else a random registry entry. */
export async function pickReaderCitizen(): Promise<CitizenDoc | null> {
  const tapped = takeTappedCard();
  if (tapped) {
    const citizen = await findCitizenByDocument(tapped);
    if (citizen) return citizen;
  }
  const pinned = process.env.KIOSK_READER_CITIZEN?.trim();
  if (pinned) {
    return cmsFindOne<CitizenDoc>(
      "citizens",
      /^\d+$/.test(pinned)
        ? { citizenKey: { equals: Number(pinned) } }
        : { citizenId: { equals: pinned.toUpperCase() } },
    );
  }
  const probe = await cmsFind<CitizenDoc>("citizens", { limit: 1 });
  if (probe.totalDocs === 0) return null;
  const page = 1 + randomInt(probe.totalDocs);
  const res = await cmsFind<CitizenDoc>("citizens", { limit: 1, page });
  return res.docs[0] ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The year the seed's ages count to, so a demo date of birth never moves. Keep in step with src/packs/malaysia/mock-documents.mjs. */
const SEED_AGE_YEAR = 2026;

/** The recorded date of birth; a seeded patient without one gets a demo date from their key and age. */
function birthDate(c: CitizenDoc): { day: number; month: number; year: number } {
  const recorded = /^(\d{4})-(\d{2})-(\d{2})/.exec(c.dateOfBirth ?? "");
  if (recorded) {
    return { year: Number(recorded[1]), month: Number(recorded[2]) - 1, day: Number(recorded[3]) };
  }
  return {
    day: 1 + ((c.citizenKey * 13) % 28),
    month: c.citizenKey % 12,
    year: SEED_AGE_YEAR - (c.age ?? 30),
  };
}

/** Whole years from a date of birth to today. */
export function ageOn(birth: { day: number; month: number; year: number }, today = new Date()): number {
  const birthdayPassed =
    today.getMonth() > birth.month || (today.getMonth() === birth.month && today.getDate() >= birth.day);
  return today.getFullYear() - birth.year - (birthdayPassed ? 0 : 1);
}

function dateOfBirth(c: CitizenDoc): string {
  const { day, month, year } = birthDate(c);
  return `${String(day).padStart(2, "0")} ${MONTHS[month]} ${year}`;
}

/** "1988-03-05" — the form a typed date of birth is compared in. */
export function dateOfBirthIso(c: CitizenDoc): string {
  const { day, month, year } = birthDate(c);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatAddress(c: CitizenDoc): string {
  return activePack().formatAddress({ ...c.address, country: c.country });
}

/** Public profile the kiosk UI receives after identity verification. */
export function toProfile(c: CitizenDoc) {
  return {
    name: c.name,
    nationalId: c.citizenId,
    country: c.country,
    age: ageOn(birthDate(c)),
    dateOfBirth: dateOfBirth(c),
    phone: c.phone ?? "",
    email: c.email ?? "",
    address: formatAddress(c),
  };
}

/** Contact details a patient gave at the kiosk, written to their record — the kiosk's stand-in for "update HIS". */
export async function updateContact(
  documentNumber: string,
  patch: { phone?: string; emergencyContact?: { name: string; phone: string; relationship?: string } },
): Promise<boolean> {
  const citizen = await findCitizenByDocument(documentNumber);
  if (!citizen) return false;
  const data: Record<string, unknown> = {};
  if (patch.phone?.trim()) data.phone = patch.phone.trim();
  if (patch.emergencyContact?.name.trim()) data.emergencyContact = patch.emergencyContact;
  if (Object.keys(data).length === 0) return false;
  await cmsUpdate("citizens", citizen.id, data);
  return true;
}
