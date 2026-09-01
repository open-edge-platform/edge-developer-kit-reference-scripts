// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { activePack } from "@/packs";
import { cmsFind, cmsFindOne, cmsUpdate } from "./cms";
import type { FacePhotoRef } from "./face";
import { randomInt } from "./random";

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
  age?: number | null;
  phone?: string | null;
  email?: string | null;
  race?: "Malay" | "Chinese" | "Indian" | "Other" | null;
  religion?: "Islam" | "Buddhist" | "Christian" | "Hindu" | "Other" | null;
  maritalStatus?: "single" | "married" | null;
  monthlyIncome?: number | null;
  isOku?: boolean | null;
  childrenUnder18?: number | null;
  idCardLossCount?: number | null;
  address: { line: string; city: string; postcode: string };
  hasCriminalRecord?: boolean | null;
  criminalRecord?: {
    type?: string | null;
    status?: string | null;
    severity?: string | null;
    officerReviewRequired?: boolean | null;
  } | null;
  hasOutstandingFines?: boolean | null;
  unpaidFineCount?: number | null;
  totalUnpaidAmount?: number | null;
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

/** The citizen a stood-in read reports. Pin one via KIOSK_READER_CITIZEN
 *  (citizen ID or CitizenKey); otherwise a random registry entry is drawn. */
export async function pickReaderCitizen(): Promise<CitizenDoc | null> {
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

function dateOfBirth(c: CitizenDoc): string {
  const age = c.age ?? 30;
  const month = c.citizenKey % 12;
  const day = 1 + ((c.citizenKey * 13) % 28);
  const year = new Date().getFullYear() - age;
  return `${String(day).padStart(2, "0")} ${MONTHS[month]} ${year}`;
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
    age: c.age ?? 30,
    dateOfBirth: dateOfBirth(c),
    phone: c.phone ?? "",
    email: c.email ?? "",
    address: formatAddress(c),
    race: c.race ?? "Other",
    religion: c.religion ?? "Other",
    maritalStatus: c.maritalStatus ?? "single",
    monthlyIncome: c.monthlyIncome ?? 0,
    isOku: Boolean(c.isOku),
    childrenUnder18: c.childrenUnder18 ?? 0,
    idCardLossCount: c.idCardLossCount ?? 0,
    outstandingFines: {
      count: c.unpaidFineCount ?? 0,
      total: c.totalUnpaidAmount ?? 0,
    },
    requiresOfficerReview: Boolean(c.criminalRecord?.officerReviewRequired),
  };
}

function parseAddress(input: string, fallback: CitizenDoc["address"]): CitizenDoc["address"] {
  const text = input.trim();
  const lastComma = text.lastIndexOf(",");
  if (lastComma === -1) return { ...fallback, line: text };
  const line = text.slice(0, lastComma).trim();
  const rest = text.slice(lastComma + 1).trim();
  const m = rest.match(/^(.*?)\s*(\d{4,6})$/) ?? rest.match(/^(\d{4,6})\s+(.*)$/);
  if (m) {
    const [city, postcode] = /^\d+$/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
    return { line, city: city || fallback.city, postcode };
  }
  return { line, city: rest || fallback.city, postcode: fallback.postcode };
}

export function updateCitizenAddress(citizen: CitizenDoc, newAddress: string): Promise<CitizenDoc> {
  return cmsUpdate<CitizenDoc>("citizens", citizen.id, {
    address: parseAddress(newAddress, citizen.address),
  });
}
