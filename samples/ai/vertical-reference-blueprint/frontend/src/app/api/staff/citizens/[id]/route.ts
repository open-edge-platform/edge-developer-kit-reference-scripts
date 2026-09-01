// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { CmsError, cmsFindOne } from "../../../_lib/cms";
import type { CitizenDoc } from "../../../_lib/citizens";
import {
  checkPortrait,
  checkUid,
  cardHolder,
  discardPortrait,
  storePortrait,
  updateCitizenEnrollment,
  type PortraitDoc,
} from "../../../_lib/enrollment";
import { badRequest, notFound } from "../../../_lib/http";
import { notStaff, staffUser } from "../../../_lib/staff";

/**
 * Bind a card and/or a portrait to a citizen who is already registered.
 *
 *   PATCH /api/staff/citizens/42        multipart: nfcUid, portrait
 *
 * This is the half of the desk that matters most in practice: the register is
 * seeded with a hundred citizens and not one of them has a card, so issuing
 * one is a lookup and a tap rather than a re-registration. Sending `nfcUid=""`
 * unbinds the card the citizen currently holds, which is how a lost card is
 * taken out of service.
 *
 * A citizen's other particulars are not editable here — those are the CMS's
 * job, and duplicating them into a second screen is how the two drift apart.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await staffUser(req))) return notStaff();

  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) return badRequest("citizen id must be a number");

  const citizen = await cmsFindOne<CitizenDoc>("citizens", { id: { equals: id } }, { depth: 1 });
  if (!citizen) return notFound(`no citizen with id ${id}`);

  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("expected multipart form data");

  const changes: { nfcUid?: string | null; faceImage?: number } = {};

  // Present-but-empty is an instruction ("unbind this card"); absent means
  // the caller is only changing the portrait and the card is left alone.
  const rawUid = form.get("nfcUid");
  if (typeof rawUid === "string") {
    if (!rawUid.trim()) {
      changes.nfcUid = null;
    } else {
      const checked = checkUid(rawUid);
      if ("error" in checked) return badRequest(checked.error);
      const holder = await cardHolder(checked.uid, id);
      if (holder) {
        return Response.json(
          {
            error:
              `card ${checked.uid} already opens ${holder.name}'s record (${holder.citizenId}). ` +
              "One card, one citizen — use a different card, or clear it off that record first.",
          },
          { status: 409 },
        );
      }
      changes.nfcUid = checked.uid;
    }
  }

  const photo = form.get("portrait");
  const hasPortrait = photo instanceof File && photo.size > 0;
  if (hasPortrait) {
    const rejected = checkPortrait(photo);
    if (rejected) return badRequest(rejected.error);
  }

  if (!hasPortrait && changes.nfcUid === undefined) {
    return badRequest("nothing to change — send a card serial, a portrait, or both");
  }

  let portrait: PortraitDoc | null = null;
  try {
    if (hasPortrait) {
      portrait = await storePortrait(photo, citizen.name);
      changes.faceImage = portrait.id;
    }
    const updated = await updateCitizenEnrollment(id, changes);
    // The portrait this replaces is deliberately left in the collection: it
    // is the evidence of who the kiosk was matching against until now, and
    // the face worker drops its own copy on the next check anyway.
    return Response.json({
      citizen: {
        id: updated.id,
        citizenKey: updated.citizenKey,
        citizenId: updated.citizenId,
        name: updated.name,
        country: updated.country,
        nfcUid: updated.nfcUid ?? null,
        portrait: portrait?.filename ?? (typeof citizen.faceImage === "object"
          ? (citizen.faceImage?.filename ?? null)
          : null),
      },
    });
  } catch (error) {
    await discardPortrait(portrait, req.headers.get("cookie") ?? "");
    if (error instanceof CmsError) {
      return Response.json({ error: error.message }, { status: error.status === 403 ? 403 : 400 });
    }
    throw error;
  }
}
