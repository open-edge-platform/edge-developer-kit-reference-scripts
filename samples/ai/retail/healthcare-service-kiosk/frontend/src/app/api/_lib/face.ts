// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  FaceServiceError,
  deletePerson,
  enrollPerson,
  faceServiceConfigured,
  gallerySize,
  listGallery,
  recognizeFrame,
  type RecognizeResult,
} from "@/lib/face-service";
import { cmsFile } from "./cms";
import { healthCheckEnabled, probeService, type ServiceHealth } from "./health";

/**
 * Face verification against the face-recognition service at
 * KIOSK_FACE_BASE_URL (the Edge AI Demo Studio worker at
 * `http://localhost:8080/api/face-recognition@face-recognition`).
 *
 * The pipeline the kiosk drives is 1:1 in intent and 1:N in mechanism:
 *
 *   1. The ID reader names a citizen; the registry holds their reference
 *      portrait (`citizens.faceImage`).
 *   2. That portrait is enrolled into the worker's gallery under the citizen's
 *      ID, once per portrait.
 *   3. The frame from the kiosk camera goes to `/recognize`, which detects
 *      every face in it and cosine-matches each against the whole gallery.
 *   4. The check passes only when the best match for a detected face IS the
 *      citizen whose card is in the reader, at or above the model's own
 *      threshold. Matching against the gallery rather than against one
 *      embedding is the point: a lookalike who scores higher than the
 *      cardholder is a failure, not a pass.
 *
 * A citizen with no reference portrait always fails — there is nothing to
 * match them against, and treating "unknown" as "verified" would be the one
 * outcome this step exists to prevent.
 */

/** Longest camera frame accepted (bytes of JPEG, before base64 encoding). */
const MAX_FRAME_BYTES = Number(process.env.KIOSK_FACE_MAX_FRAME_BYTES ?? 8_000_000);

/**
 * Decode a frame captured off the kiosk camera. The client sends a JPEG data
 * URL (`data:image/jpeg;base64,…`); a bare base64 string is accepted too, so
 * a caller that already stripped the prefix still works.
 */
export function decodeFrame(image: string | undefined): Uint8Array | null {
  if (!image) return null;
  const base64 = image.includes(",") ? image.slice(image.indexOf(",") + 1) : image;
  if (!base64.trim()) return null;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) return null;
  return new Uint8Array(bytes);
}

/** Probed for liveness; the worker reports model-loaded state here. */
const HEALTH_PATH = process.env.KIOSK_FACE_HEALTH_PATH ?? "/healthcheck";
/**
 * Optional floor over the model's own decision threshold. Unset means trust
 * the worker: each pipeline ships a calibrated threshold (0.4 for the OMZ
 * re-identification model, 0.363 for SFace) and second-guessing it from here
 * only makes the kiosk stricter than the model was tuned to be.
 */
const MIN_SIMILARITY = process.env.KIOSK_FACE_MIN_SIMILARITY
  ? Number(process.env.KIOSK_FACE_MIN_SIMILARITY)
  : null;

/**
 * Whether a face match is *required* to establish identity.
 *
 * Off by default, mirroring how the rest of this kit treats an optional
 * service: a check that could not run — no service configured, the service
 * down, or a terminal with no working camera — falls back to the simulated
 * scan rather than stranding a citizen who has a card in the reader and no
 * way to finish. Turn it on for an install where the face match is the
 * security control rather than a demonstration of one, and every one of those
 * cases becomes a refusal instead.
 *
 * It never affects the checks that are *about the person*: no reference
 * portrait, no face in frame, and the wrong face all fail either way.
 */
export const faceMatchRequired = () =>
  (process.env.KIOSK_FACE_REQUIRE_MATCH ?? "false") === "true";

/** Reachability of the face-recognition service. See ./health for the codes. */
export const faceHealth = (): Promise<ServiceHealth> =>
  probeService({
    baseUrl: process.env.KIOSK_FACE_BASE_URL?.replace(/\/$/, ""),
    path: HEALTH_PATH,
    enabled: healthCheckEnabled("KIOSK_FACE_HEALTH_CHECK"),
  });

/* ── Keeping the worker's gallery in step with the registry ───────────────── */

/**
 * The worker's gallery is shared, not this kiosk's own: every kiosk in a
 * bundle talks to the one studio worker. Under bare citizen IDs, a person on
 * file with another kiosk under a different record was in this kiosk's match
 * too — and as the stronger "lookalike" of themselves, failed here. Entries
 * are therefore enrolled under this kiosk's prefix, and only those compete.
 */
const GALLERY_PREFIX = "healthcare:";
const galleryName = (citizenId: string) => `${GALLERY_PREFIX}${citizenId}`;
const isOurs = (name: string) => name.startsWith(GALLERY_PREFIX);

/**
 * Which portrait this worker currently holds for each citizen.
 *
 * Two things can put this out of date, and both have to be caught or the
 * kiosk quietly matches against the wrong picture:
 *
 * - The worker's gallery lives in memory, so it empties when the worker
 *   restarts while this process keeps running. `size` is the gallery size the
 *   worker last reported; when the two disagree the cache is rebuilt.
 * - An admin can change a citizen's portrait in the CMS at any time. The
 *   enrolled photo is therefore remembered by key, and a citizen whose key has
 *   moved on is dropped from the gallery and enrolled again — otherwise
 *   uploading a new portrait would have no effect until the worker restarted.
 */
type Enrollment = { personId: string; photoKey: string };
const enrolled: { byCitizen: Map<string, Enrollment>; size: number } = {
  byCitizen: new Map(),
  size: -1,
};

class InvalidReferencePortrait extends Error {}

async function refreshGallery(): Promise<void> {
  const persons = await listGallery();
  // The worker does not report which image it holds, so nothing learned this
  // way can vouch for a portrait — the empty key forces a re-enroll on use.
  enrolled.byCitizen = new Map(
    persons
      .filter((p) => isOurs(p.name))
      .map((p) => [p.name.slice(GALLERY_PREFIX.length), { personId: p.id, photoKey: "" }]),
  );
  // Every kiosk's entries, like the gallery_size it is compared against.
  enrolled.size = persons.length;
}

/** Drop this citizen from the worker's gallery, if we know they are in it. */
async function forgetEnrollment(citizenId: string): Promise<void> {
  const current = enrolled.byCitizen.get(citizenId);
  if (!current) return;
  await deletePerson(current.personId).catch(() => {});
  enrolled.byCitizen.delete(citizenId);
  enrolled.size -= 1;
}

/** Enroll the citizen's reference portrait, unless the worker already has it. */
async function ensureEnrolled(citizenId: string, photo: ReferencePhoto): Promise<void> {
  // The worker's own count is the authority — ours is only a way to avoid
  // listing a gallery that has not changed. A worker that will not say how
  // big its gallery is gets listed rather than trusted.
  const size = await gallerySize().catch(() => undefined);
  if (size !== enrolled.size) await refreshGallery();

  if (enrolled.byCitizen.get(citizenId)?.photoKey === photo.key) return;
  await forgetEnrollment(citizenId);

  const { bytes, mimeType } = await cmsFile("face-photos", photo.filename);
  let person: Awaited<ReturnType<typeof enrollPerson>>;
  try {
    person = await enrollPerson(galleryName(citizenId), {
      bytes,
      mimeType: photo.mimeType || mimeType,
      fileName: photo.filename,
    });
  } catch (error) {
    if (error instanceof FaceServiceError && error.status >= 400 && error.status < 500) {
      throw new InvalidReferencePortrait(error.message);
    }
    throw error;
  }
  enrolled.byCitizen.set(citizenId, { personId: person.id, photoKey: photo.key });
  enrolled.size += 1;
}

/* ── The kiosk-facing verdict ─────────────────────────────────────────────── */

/**
 * Why a face check did not pass. Each case means something different to the
 * person standing at the machine, so none of them collapse into "failed":
 *
 * - `off`          the service is not configured — the check never ran
 * - `unreachable`  it is configured but down or erroring
 * - `no_capture`   no camera frame reached the server
 * - `no_reference` the citizen has no portrait on file — nothing to match
 * - `bad_reference` there IS a portrait, but no face can be found in it
 * - `bad_capture` the face service could not process the live camera frame
 * - `no_face`      the frame contains no detectable face
 * - `mismatch`     a face was read, and it is not the cardholder's
 */
export type FaceFailure =
  | "off"
  | "unreachable"
  | "no_capture"
  | "no_reference"
  | "bad_reference"
  | "bad_capture"
  | "no_face"
  | "mismatch";

export type FaceMatch =
  | { ok: true; similarity: number; threshold: number }
  | { ok: false; reason: FaceFailure; similarity: number | null; detail?: string };

/** A citizen row's `faceImage`, as the CMS returns it at depth 1. */
export type FacePhotoRef =
  | { filename?: string | null; mimeType?: string | null; updatedAt?: string | null }
  | number
  | null;

type ReferencePhoto = { filename: string; mimeType: string; key: string };

/**
 * The portrait to match against, plus the key that identifies *which* picture
 * it is. `updatedAt` is part of the key as well as the name because replacing
 * the file on an existing photo record can keep the filename.
 */
function referencePhoto(faceImage: FacePhotoRef): ReferencePhoto | null {
  if (typeof faceImage !== "object" || !faceImage?.filename) return null;
  return {
    filename: faceImage.filename,
    mimeType: faceImage.mimeType ?? "image/jpeg",
    key: `${faceImage.filename}@${faceImage.updatedAt ?? ""}`,
  };
}

/**
 * Verify one captured frame against one citizen's enrolled portrait.
 *
 * `frame` is the JPEG the kiosk camera produced, or null when there was no
 * camera to produce one.
 */
export async function verifyFace(
  citizenId: string,
  faceImage: FacePhotoRef,
  frame: Uint8Array | null,
): Promise<FaceMatch> {
  if (!faceServiceConfigured()) return { ok: false, reason: "off", similarity: null };

  // Checked before the frame is: a citizen with no portrait can never pass
  // this check, and saying so does not depend on the camera having worked.
  const photo = referencePhoto(faceImage);
  if (!photo) {
    // Their portrait may have just been removed in the CMS. Retiring the
    // gallery entry matters for everybody else: left there, it goes on
    // competing for the best match and can reject the citizen it now
    // resembles most. Only the cached entry is cleaned up — listing the
    // gallery to hunt for one would put a worker round-trip on a path whose
    // whole job is to fail immediately.
    await forgetEnrollment(citizenId);
    return { ok: false, reason: "no_reference", similarity: null };
  }

  if (!frame || frame.length === 0) return { ok: false, reason: "no_capture", similarity: null };

  try {
    await ensureEnrolled(citizenId, photo);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof InvalidReferencePortrait ? "bad_reference" : "unreachable",
      similarity: null,
      detail: (error as Error).message,
    };
  }

  let result: RecognizeResult;
  try {
    result = await recognizeFrame(frame);
  } catch (error) {
    // A 4xx here is about the live frame, not the registry portrait.
    const status = error instanceof FaceServiceError ? error.status : 0;
    return {
      ok: false,
      reason: status >= 400 && status < 500 ? "bad_capture" : "unreachable",
      similarity: null,
      detail: (error as Error).message,
    };
  }

  if (result.num_faces === 0) return { ok: false, reason: "no_face", similarity: null };

  // Several people can be in frame at a public terminal. The cardholder only
  // has to be one of them — but on the face that is theirs, they must still be
  // the strongest match in the gallery, not merely present in it.
  const threshold = MIN_SIMILARITY ?? result.threshold;
  const name = galleryName(citizenId);
  const scored = result.faces.map((face) => {
    // The worker's own `match` ranks every kiosk's entries; ours is re-ranked
    // over this kiosk's registry alone.
    const ours = face.similarities.filter((s) => isOurs(s.name));
    return {
      top: ours.length ? ours.reduce((a, b) => (b.similarity > a.similarity ? b : a)) : null,
      similarity: ours.find((s) => s.name === name)?.similarity ?? null,
    };
  });
  const best = scored.reduce((a, b) => ((b.similarity ?? -1) > (a.similarity ?? -1) ? b : a));

  const isCardholder = best.top?.name === name;
  if (isCardholder && best.similarity !== null && best.similarity >= threshold) {
    return { ok: true, similarity: best.similarity, threshold };
  }
  return {
    ok: false,
    reason: "mismatch",
    similarity: best.similarity,
    detail: isCardholder
      ? `similarity ${best.similarity?.toFixed(3)} is below the ${threshold} threshold`
      : best.top
        ? `the strongest match in the gallery is ${best.top.name.slice(GALLERY_PREFIX.length)}, not ${citizenId}`
        : `no gallery entry is close enough to the face in frame`,
  };
}

/** What the citizen is told when a check did not pass. */
export const FACE_FAILURE_MESSAGE: Record<FaceFailure, string> = {
  off: "the face scanner is not configured on this kiosk",
  unreachable: "the face scanner is not responding — please ask a staff member for help",
  no_capture: "the camera did not send a picture — please try again",
  no_reference:
    "there is no reference photo on your registry record, so your face cannot be matched — " +
    "please see a staff member to have one taken",
  bad_reference:
    "the reference photo on your registry record cannot be read — please see a staff member " +
    "to have a new one taken",
  bad_capture:
    "the face scanner could not process the camera picture — please reposition your face and try again",
  no_face: "we couldn't see a face in the picture — step into the oval and try again",
  mismatch: "your face didn't match the photo on your registry record",
};
