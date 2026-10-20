// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { describeSet, manifestOf, person, renderSet } from "@/packs/malaysia/mock-documents.mjs";
import { cmsFind, cmsFindOne } from "./cms";
import type { CitizenDoc } from "./citizens";
import { zip, type ZipEntry } from "./zip";

/**
 * The mock documents for one citizen on the register, for /mock-documents:
 * the set that matches the register and the tampered set the kiosk must
 * reject. Rendered on request — nothing is written to disk.
 */

export const VARIANTS = ["good", "false"] as const;
export type Variant = (typeof VARIANTS)[number];

type Person = ReturnType<typeof person>;

export type MockSets = { holder: Person; donor: Person | null };

const toPerson = (c: CitizenDoc): Person =>
  person({
    CitizenKey: c.citizenKey,
    SyntheticCitizenID: c.citizenId,
    SyntheticName: c.name,
    Country: c.country,
    Age: c.age ?? "",
    Phone: c.phone ?? "",
    Email: c.email ?? "",
    AddressLine: c.address?.line ?? "",
    City: c.address?.city ?? "",
    Postcode: c.address?.postcode ?? "",
  });

/** The next citizen by key, wrapping round — the same donor `npm run mocks:gen` picks for a seeded citizen. */
async function donorFor(c: CitizenDoc): Promise<CitizenDoc | null> {
  const next = await cmsFind<CitizenDoc>("citizens", {
    where: { citizenKey: { greater_than: c.citizenKey } },
    sort: "citizenKey",
    limit: 1,
  });
  const donor =
    next.docs[0] ?? (await cmsFind<CitizenDoc>("citizens", { sort: "citizenKey", limit: 1 })).docs[0];
  return donor && donor.id !== c.id ? donor : null;
}

/** Both sets for a registry row id, or null when nobody has it; donor is null on a register of one. */
export async function mockSets(id: number): Promise<MockSets | null> {
  const citizen = await cmsFindOne<CitizenDoc>("citizens", { id: { equals: id } });
  if (!citizen) return null;
  const donor = await donorFor(citizen);
  return { holder: toPerson(citizen), donor: donor && toPerson(donor) };
}

const donorOf = (sets: MockSets, variant: Variant) => (variant === "good" ? null : sets.donor);

export function describeSets({ holder, donor }: MockSets) {
  return {
    citizen: { name: holder.name, citizenId: holder.id, slug: holder.slug },
    sets: [
      { variant: "good" as const, donor: null, files: describeSet(holder, null) },
      ...(donor ? [{ variant: "false" as const, donor: donor.name, files: describeSet(holder, donor) }] : []),
    ],
  };
}

/** One PDF of a set, or null when the set has no such file. */
export async function renderDocument(sets: MockSets, variant: Variant, file: string) {
  const [doc] = await renderSet(sets.holder, donorOf(sets, variant), file);
  return doc ?? null;
}

/** The sets as a zip laid out like assets/mocks/citizens, so it unpacks straight into a mocks dir. */
export async function zipSets(sets: MockSets, variants: readonly Variant[]): Promise<Buffer> {
  const entries: ZipEntry[] = [];
  for (const variant of variants) {
    const donor = donorOf(sets, variant);
    if (variant === "false" && !donor) continue;
    const dir = `${sets.holder.slug}/${variant}`;
    for (const { file, bytes } of await renderSet(sets.holder, donor)) {
      entries.push({ name: `${dir}/${file}`, bytes });
    }
    const manifest = JSON.stringify(manifestOf(sets.holder, donor), null, 2) + "\n";
    entries.push({ name: `${dir}/manifest.json`, bytes: Buffer.from(manifest) });
  }
  return zip(entries);
}
