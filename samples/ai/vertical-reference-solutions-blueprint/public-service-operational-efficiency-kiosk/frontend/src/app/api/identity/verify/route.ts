// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, delay, notFound, oneOf, readJson, unavailable } from "../../_lib/http";
import { findCitizenByDocument, toProfile } from "../../_lib/citizens";
import {
  FACE_FAILURE_MESSAGE,
  faceMatchRequired,
  verifyFace,
  type FaceFailure,
  type FaceMatch,
} from "../../_lib/face";

const METHODS = ["face", "fingerprint"] as const;
const SCAN_MS = Number(process.env.KIOSK_IDENTITY_SCAN_MS ?? 2300);

/** Longest camera frame accepted (bytes of JPEG, before base64 encoding). */
const MAX_FRAME_BYTES = Number(process.env.KIOSK_FACE_MAX_FRAME_BYTES ?? 8_000_000);

/**
 * Decode the captured frame. The client sends a JPEG data URL
 * (`data:image/jpeg;base64,…`); a bare base64 string is accepted too, so a
 * caller that already stripped the prefix still works.
 */
function decodeFrame(image: string | undefined): Uint8Array | null {
  if (!image) return null;
  const base64 = image.includes(",") ? image.slice(image.indexOf(",") + 1) : image;
  if (!base64.trim()) return null;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) return null;
  return new Uint8Array(bytes);
}

/**
 * Match a biometric against the citizen record for the read ID document.
 *
 * The face check is a real one when the kiosk has everything it needs: a
 * frame from the camera, a reference portrait on the citizen's registry
 * record, and the face-recognition service configured. It runs through
 * `verifyFace` — enroll the portrait, recognise the frame, and pass only if
 * the cardholder is the strongest match in the gallery.
 *
 * Two failures are deliberately NOT treated the same way:
 *
 * - Anything the check learned *about the person* — no reference portrait on
 *   their record, no face in the frame, or a face that is somebody else's —
 *   is a refusal. A check that cannot distinguish this citizen from anybody
 *   else must never report that it did.
 * - The check never running at all — no face service configured, the service
 *   down, or a terminal whose camera could not produce a frame — falls back
 *   to the simulated scan this kiosk has always done, because the
 *   alternative is an install without the face worker refusing every citizen
 *   at step two. `face.require_match` turns those into refusals too, for an
 *   install where the match is the security control rather than a
 *   demonstration of one.
 */
export async function POST(req: Request) {
  const { method, documentNumber, image } = await readJson<{
    method: string;
    documentNumber: string;
    /** JPEG data URL captured from the kiosk camera. */
    image: string;
  }>(req);

  const checked = oneOf(method, METHODS, "method");
  if (!checked.ok) return checked.response;
  if (checked.value === "fingerprint") {
    return badRequest("the thumbprint scanner is not supported for now — use the face scan");
  }
  if (!documentNumber) {
    return badRequest("documentNumber is required — read the ID document first");
  }

  // depth 1 so `faceImage` arrives as the photo record (filename, mime type)
  // rather than as a bare row id the face check could do nothing with.
  const citizen = await findCitizenByDocument(documentNumber, { depth: 1 });
  if (!citizen) {
    return notFound(`no citizen record matches document ${documentNumber}`);
  }

  const match = await verifyFace(citizen.citizenId, citizen.faceImage ?? null, decodeFrame(image));
  const rejection = faceRejection(match);
  if (rejection) return rejection;

  // The scan window is the mock peripheral's, not the model's: a real match
  // has already taken its own time, so only a simulated one still waits.
  if (!match.ok) await delay(SCAN_MS);
  return Response.json({
    method: checked.value,
    documentNumber,
    verifiedAt: new Date().toISOString(),
    /** How identity was actually established, for the audit line. */
    faceMatch: match.ok
      ? { checked: true, similarity: match.similarity, threshold: match.threshold }
      : { checked: false, reason: match.reason },
    profile: toProfile(citizen),
  });
}

/** Reasons the check never ran, as opposed to running and rejecting. */
const NOT_ATTEMPTED = new Set<FaceFailure>([
  "off",
  "unreachable",
  "no_capture",
]);

/** The response for a face check that failed, or null if the citizen may pass. */
function faceRejection(match: FaceMatch): Response | null {
  if (match.ok) return null;
  if (NOT_ATTEMPTED.has(match.reason)) {
    // Nothing was learned about this citizen either way — fall back to the
    // simulated scan unless the install insists on a real match.
    if (!faceMatchRequired()) return null;
    if (match.reason === "unreachable") return unavailable(FACE_FAILURE_MESSAGE.unreachable);
  }
  return Response.json(
    { error: FACE_FAILURE_MESSAGE[match.reason], reason: match.reason },
    { status: 401 },
  );
}
