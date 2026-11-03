// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, delay, notFound, oneOf, readJson, unavailable } from "../../_lib/http";
import { dateOfBirthIso, findCitizenByDocument, toProfile, type CitizenDoc } from "../../_lib/citizens";
import {
  FACE_FAILURE_MESSAGE,
  decodeFrame,
  faceMatchRequired,
  verifyFace,
  type FaceFailure,
  type FaceMatch,
} from "../../_lib/face";
import { noteServedPatient } from "../../_lib/served-patient";

const METHODS = ["face", "fingerprint", "dob"] as const;
const SCAN_MS = Number(process.env.KIOSK_IDENTITY_SCAN_MS ?? 2300);

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
  const { method, documentNumber, image, dateOfBirth } = await readJson<{
    method: string;
    documentNumber: string;
    /** JPEG data URL captured from the kiosk camera. */
    image: string;
    /** "YYYY-MM-DD", the second identifier after a scanned card or slip. */
    dateOfBirth: string;
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

  if (checked.value === "dob") return confirmBirthDate(citizen, dateOfBirth ?? "");

  const match = await verifyFace(citizen.citizenId, citizen.faceImage ?? null, decodeFrame(image));
  const rejection = faceRejection(match);
  if (rejection) return rejection;

  // The scan window is the mock peripheral's, not the model's: a real match
  // has already taken its own time, so only a simulated one still waits.
  if (!match.ok) await delay(SCAN_MS);
  noteServedPatient(citizen.citizenId);
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
  console.warn(`[face] check did not pass: ${match.reason}${match.detail ? ` — ${match.detail}` : ""}`);
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

const DOB_ATTEMPTS = 3;
const DOB_LOCK_MS = 10 * 60_000;
const FAILURES = Symbol.for("kiosk.identity.dobFailures");
type Global = { [FAILURES]?: Map<string, { count: number; until: number }> };

function failures(): Map<string, { count: number; until: number }> {
  const globals = globalThis as Global;
  return (globals[FAILURES] ??= new Map());
}

/** Never says which part was wrong, and stops guessing after three tries. */
function confirmBirthDate(citizen: CitizenDoc, given: string): Response {
  const key = citizen.citizenId;
  const now = Date.now();
  const record = failures().get(key);
  if (record && record.count >= DOB_ATTEMPTS && record.until > now) {
    return Response.json(
      { error: "Please see the registration counter so we can confirm who you are.", reason: "locked" },
      { status: 429 },
    );
  }
  if (given.trim() !== dateOfBirthIso(citizen)) {
    const count = record && record.until > now ? record.count + 1 : 1;
    failures().set(key, { count, until: now + DOB_LOCK_MS });
    return Response.json(
      {
        error:
          count >= DOB_ATTEMPTS
            ? "Please see the registration counter so we can confirm who you are."
            : "Those details don't match our records. Please check and try again.",
        reason: count >= DOB_ATTEMPTS ? "locked" : "mismatch",
        attemptsLeft: Math.max(DOB_ATTEMPTS - count, 0),
      },
      { status: count >= DOB_ATTEMPTS ? 429 : 401 },
    );
  }
  failures().delete(key);
  noteServedPatient(citizen.citizenId);
  return Response.json({
    method: "dob",
    documentNumber: citizen.citizenId,
    verifiedAt: new Date().toISOString(),
    faceMatch: { checked: false, reason: "date_of_birth" },
    profile: toProfile(citizen),
  });
}
