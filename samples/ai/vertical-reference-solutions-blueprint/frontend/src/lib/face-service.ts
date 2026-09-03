// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Low-level client for the face-recognition worker (Edge AI Demo Studio's
 * `/api/face-recognition`, or the worker on its own port).
 *
 * Only the HTTP surface lives here — no policy, no registry, no verdict — so
 * that both sides of the app can talk to the worker without importing each
 * other: the kiosk's identity check (`src/app/api/_lib/face.ts`) builds its
 * verdict on top of these calls, and the CMS uses `detectFaces` to tell an
 * admin at upload time whether the portrait they picked is usable at all.
 *
 * Settings are read per call rather than at module load: this module is
 * imported from the Payload config as well as from the kiosk routes, and the
 * two are evaluated at different points relative to config.yaml being applied.
 */

import { safeUrl, URL_CHARS } from "@/lib/validation";

const baseUrl = () => process.env.KIOSK_FACE_BASE_URL?.replace(/\/$/, "");
const timeoutMs = () => Number(process.env.KIOSK_FACE_TIMEOUT_MS ?? 30_000);

/** Whether a face service is configured at all. */
export const faceServiceConfigured = () => Boolean(baseUrl());

/** An error reply from the worker. The status separates "you sent something
 *  it cannot use" (4xx) from "it is broken or down" (5xx, network). */
export class FaceServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FaceServiceError";
  }
}

async function faceFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = baseUrl();
  if (!base) throw new FaceServiceError(0, "no face service is configured");
  // Rebuilt inline, character by character off the allowlist: the security
  // scan only trusts sanitization done in the same function as the fetch.
  let target = "";
  for (const ch of safeUrl(`${base}${path}`)) {
    let ok = "";
    for (const allowed of URL_CHARS) {
      if (allowed === ch) {
        ok = allowed;
        break;
      }
    }
    if (!ok) throw new FaceServiceError(0, "the face service URL contains a forbidden character");
    target += ok;
  }
  let res: Response;
  try {
    res = await fetch(target, { ...init, signal: AbortSignal.timeout(timeoutMs()) });
  } catch (error) {
    // Never reached the service at all — status 0, so callers can tell this
    // apart from a service that answered and refused.
    throw new FaceServiceError(0, (error as Error).message);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new FaceServiceError(res.status, body?.detail ?? `face service returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const blobOf = (bytes: Uint8Array, mimeType: string) =>
  new Blob([bytes as unknown as BlobPart], { type: mimeType });

export type GalleryPerson = { id: string; name: string; num_images: number };

export type RecognizedFace = {
  score: number;
  matched: boolean;
  match: { person_id: string; name: string; similarity: number } | null;
  similarities: { person_id: string; name: string; similarity: number }[];
};

export type RecognizeResult = {
  gallery_size: number;
  threshold: number;
  num_faces: number;
  faces: RecognizedFace[];
};

/**
 * The worker's own gallery count. Read from a fixed path, unlike the
 * configurable liveness probe: this is a field only the worker's endpoint
 * returns, and pointing it at a generic health page would silently stop the
 * enrollment cache from noticing a restart.
 */
export const gallerySize = () =>
  faceFetch<{ gallery_size?: number }>("/healthcheck").then((h) => h.gallery_size);

export const listGallery = () =>
  faceFetch<{ persons: GalleryPerson[] }>("/gallery").then((g) => g.persons);

/** Enroll one reference image under `name`. Rejects (400) an image with no face. */
export function enrollPerson(
  name: string,
  image: { bytes: Uint8Array; mimeType: string; fileName: string },
): Promise<GalleryPerson> {
  const form = new FormData();
  form.append("name", name);
  form.append("files", blobOf(image.bytes, image.mimeType), image.fileName);
  return faceFetch<{ person: GalleryPerson }>("/gallery", {
    method: "POST",
    body: form,
  }).then((r) => r.person);
}

export const deletePerson = (personId: string) =>
  faceFetch<unknown>(`/gallery/${encodeURIComponent(personId)}`, { method: "DELETE" });

/** Detect and match every face in a frame against the enrolled gallery. */
export function recognizeFrame(bytes: Uint8Array, mimeType = "image/jpeg") {
  const form = new FormData();
  form.append("file", blobOf(bytes, mimeType), "frame.jpg");
  return faceFetch<RecognizeResult>("/recognize", { method: "POST", body: form });
}

/**
 * How many faces are in an image, without enrolling anything.
 *
 * Used to check a reference portrait at the moment it is uploaded: the same
 * detector that will later have to find a face in it says now whether it can,
 * so an unusable photo is caught in the CMS rather than at the kiosk by the
 * citizen it belongs to.
 */
export const detectFaces = (bytes: Uint8Array, mimeType: string) =>
  recognizeFrame(bytes, mimeType).then((r) => r.num_faces);
