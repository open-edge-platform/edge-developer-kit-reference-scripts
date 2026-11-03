// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, conflict, notFound, param, readJson } from "../_lib/http";
import { toProfile } from "../_lib/citizens";
import { decodeFrame } from "../_lib/face";
import { moduleOff } from "../_lib/modules";
import { completeEnrollment, discardEnrollment } from "../_lib/self-enrollment";
import { noteServedPatient } from "../_lib/served-patient";

/**
 * POST `{ token, image }` — register the patient whose MyKad read
 * (GET /api/enroll/card) they confirmed, with `image` as their record photo.
 * Omit `image` on a kiosk whose camera could not take one.
 *
 * Answers the way /api/identity/verify does: the patient was just
 * photographed with the card that now opens their record, so the rest of the
 * visit treats them as verified.
 */
export async function POST(req: Request) {
  const off = moduleOff("register");
  if (off) return off;

  const { token, image } = await readJson<{ token: string; image: string }>(req);
  if (!token) return badRequest("token is required — read the MyKad first");

  const made = await completeEnrollment(token, decodeFrame(image));
  if ("reason" in made) {
    const extra = { reason: made.reason };
    if (made.reason === "expired") return notFound(made.error, extra);
    if (made.reason === "registered") return conflict(made.error, extra);
    return badRequest(made.error, extra);
  }

  const { citizen } = made;
  noteServedPatient(citizen.citizenId);
  return Response.json(
    {
      method: "face",
      documentNumber: citizen.citizenId,
      verifiedAt: new Date().toISOString(),
      faceMatch: { checked: false, reason: made.portrait ? "enrolled" : "no_capture" },
      profile: toProfile(citizen),
      /** False when the record was made without a photo, for the counter to take. */
      portrait: made.portrait,
    },
    { status: 201 },
  );
}

/** DELETE `?token=` — the patient said the details are not theirs. */
export async function DELETE(req: Request) {
  discardEnrollment(param(req, "token"));
  return Response.json({ discarded: true });
}
