// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { CmsError, cmsFind, cmsFindOne } from "../../_lib/cms";
import { ageOn, type CitizenDoc } from "../../_lib/citizens";
import {
  checkBirthDate,
  checkPortrait,
  checkUid,
  cardHolder,
  citizenSummary,
  createCitizen,
  discardPortrait,
  nextCitizenKey,
  storePortrait,
  type PortraitDoc,
} from "../../_lib/enrollment";
import { countryList, isSupportedCountry } from "@/lib/countries";
import { badRequest, param } from "../../_lib/http";
import { notStaff, staffUser } from "../../_lib/staff";

// Staff-only, on the CMS admin session — see ../../_lib/staff.

const SEARCH_LIMIT = 8;

const summary = (c: CitizenDoc) => citizenSummary(c);

const SEXES = ["female", "male"];

export async function GET(req: Request) {
  if (!(await staffUser(req))) return notStaff();

  const q = param(req, "q");
  if (!q) {
    const recent = await cmsFind<CitizenDoc>("citizens", {
      limit: SEARCH_LIMIT,
      sort: "-citizenKey",
      depth: 1,
    });
    return Response.json({ citizens: recent.docs.map(summary) });
  }

  const [byName, byId] = await Promise.all([
    cmsFind<CitizenDoc>("citizens", {
      where: { name: { like: q } },
      limit: SEARCH_LIMIT,
      depth: 1,
    }),
    cmsFind<CitizenDoc>("citizens", {
      where: { citizenId: { like: q } },
      limit: SEARCH_LIMIT,
      depth: 1,
    }),
  ]);
  const merged = new Map<number, CitizenDoc>();
  for (const doc of [...byName.docs, ...byId.docs]) merged.set(doc.id, doc);
  return Response.json({
    citizens: [...merged.values()].slice(0, SEARCH_LIMIT).map(summary),
  });
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  if (!(await staffUser(req))) return notStaff();

  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("expected multipart form data");

  const name = field(form, "name");
  const citizenId = field(form, "citizenId").toUpperCase();
  const country = field(form, "country");
  const address = {
    line: field(form, "addressLine"),
    city: field(form, "city"),
    postcode: field(form, "postcode"),
  };

  if (!name) return badRequest("the patient's full name is required");
  if (!citizenId) return badRequest("an IC or passport number is required");
  if (!isSupportedCountry(country)) {
    return badRequest(`country must be ${countryList()}`);
  }
  if (!address.line || !address.city || !address.postcode) {
    return badRequest("a street address, city and postcode are required");
  }
  const birth = checkBirthDate(field(form, "dateOfBirth"));
  if ("error" in birth) return badRequest(birth.error);
  const sex = field(form, "sex");
  if (sex && !SEXES.includes(sex)) return badRequest(`sex must be ${SEXES.join(" or ")}`);

  if (await cmsFindOne<CitizenDoc>("citizens", { citizenId: { equals: citizenId } })) {
    return Response.json(
      { error: `${citizenId} is already registered — find them under "Card for an existing patient" instead` },
      { status: 409 },
    );
  }

  // Checked before anything is written: a serial another citizen holds aborts the enrollment.
  let nfcUid: string | null = null;
  const rawUid = field(form, "nfcUid");
  if (rawUid) {
    const checked = checkUid(rawUid);
    if ("error" in checked) return badRequest(checked.error);
    const holder = await cardHolder(checked.uid);
    if (holder) {
      return Response.json(
        {
          error:
            `card ${checked.uid} already opens ${holder.name}'s record (${holder.citizenId}). ` +
            "One card, one patient — use a different card, or clear it off that record first.",
        },
        { status: 409 },
      );
    }
    nfcUid = checked.uid;
  }

  const photo = form.get("portrait");
  const hasPortrait = photo instanceof File && photo.size > 0;
  if (hasPortrait) {
    const rejected = checkPortrait(photo);
    if (rejected) return badRequest(rejected.error);
  }

  let portrait: PortraitDoc | null = null;
  try {
    // Uploaded first: the face-photos collection can still reject the picture.
    if (hasPortrait) portrait = await storePortrait(photo, name);

    const [year, month, day] = birth.iso.slice(0, 10).split("-").map(Number);
    const citizen = await createCitizen({
      citizenKey: await nextCitizenKey(),
      citizenId,
      name,
      country,
      address,
      nfcUid,
      ...(portrait ? { faceImage: portrait.id } : {}),
      dateOfBirth: birth.iso,
      age: ageOn({ year, month: month - 1, day }),
      sex: sex || null,
      phone: field(form, "phone") || null,
      email: field(form, "email") || null,
      allergies: field(form, "allergies") || null,
      emergencyContact: {
        name: field(form, "emergencyName") || null,
        relationship: field(form, "emergencyRelationship") || null,
        phone: field(form, "emergencyPhone") || null,
      },
      notes: field(form, "notes") || null,
    });

    return Response.json({ citizen: citizenSummary(citizen, portrait) }, { status: 201 });
  } catch (error) {
    // The portrait is already in the CMS — don't leave an orphaned photo the matcher enrolls from.
    await discardPortrait(portrait, req.headers.get("cookie") ?? "");
    if (error instanceof CmsError) {
      return Response.json({ error: error.message }, { status: error.status === 403 ? 403 : 400 });
    }
    throw error;
  }
}
