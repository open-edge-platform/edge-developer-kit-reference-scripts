// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Payload Local API client for the CMS, which always runs in this process.
 * Remote dependencies (LLM, speech, OCR, face) are separate services, each
 * configured with its own base URL and API key — the CMS is not one of them.
 * The REST API at /cms-api stays up for the admin UI and external callers
 * (tests, scripts) bearing the kiosk key; nothing in here goes through it.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import config from "@payload-config";
import { getPayload, type CollectionSlug, type Payload, type Where } from "payload";

const cms = (): Promise<Payload> => getPayload({ config });

/** A forwarded header value with CR/LF stripped, so it cannot smuggle extra headers. */
const headerSafe = (value: string) => value.replace(/[\r\n]/g, "");

export class CmsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CmsError";
  }
}

/** Hook refusals arrive as Payload APIError carrying a status; keep both. */
function asCmsError(error: unknown): CmsError {
  if (error instanceof CmsError) return error;
  const status = (error as { status?: unknown })?.status;
  const message =
    error instanceof Error && error.message ? error.message : "CMS request failed";
  return new CmsError(typeof status === "number" ? status : 500, message);
}

/** Equality/like constraints per field, e.g. { citizenId: { equals: id } }. */
export type CmsWhere = Record<string, Record<string, string | number | boolean>>;

export type CmsFindResult<T> = {
  docs: T[];
  totalDocs: number;
  page: number;
  totalPages: number;
};

export async function cmsFind<T>(
  collection: string,
  opts: { where?: CmsWhere; limit?: number; page?: number; sort?: string; depth?: number } = {},
): Promise<CmsFindResult<T>> {
  try {
    const payload = await cms();
    const res = await payload.find({
      collection: collection as CollectionSlug,
      where: opts.where as Where | undefined,
      limit: opts.limit,
      page: opts.page,
      sort: opts.sort,
      depth: opts.depth ?? 0,
    });
    return {
      docs: res.docs as T[],
      totalDocs: res.totalDocs,
      page: res.page ?? 1,
      totalPages: res.totalPages,
    };
  } catch (error) {
    throw asCmsError(error);
  }
}

export async function cmsFindOne<T>(
  collection: string,
  where: CmsWhere,
  opts: { depth?: number } = {},
): Promise<T | null> {
  const res = await cmsFind<T>(collection, { where, limit: 1, depth: opts.depth });
  return res.docs[0] ?? null;
}

/**
 * Bytes of an uploaded file, read from the collection's staticDir on disk —
 * the CMS is in-process, so its files are on this filesystem by definition.
 * The document is looked up first, so an unknown filename is a 404 rather
 * than a filesystem probe.
 */
export async function cmsFile(
  collection: string,
  filename: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const payload = await cms();
  const staticDir = payload.collections[collection as CollectionSlug]?.config.upload?.staticDir;
  if (!staticDir) throw new CmsError(404, `${collection} is not an upload collection`);
  const doc = await cmsFindOne<{ mimeType?: string | null }>(collection, {
    filename: { equals: filename },
  });
  if (!doc) throw new CmsError(404, `Could not read ${collection}/${filename} (404)`);
  try {
    const bytes = await readFile(path.join(staticDir, path.basename(filename)));
    return {
      bytes: new Uint8Array(bytes),
      mimeType: doc.mimeType ?? "application/octet-stream",
    };
  } catch {
    throw new CmsError(404, `Could not read ${collection}/${filename} (missing on disk)`);
  }
}

export async function cmsCreate<T>(collection: string, data: unknown): Promise<T> {
  try {
    const payload = await cms();
    const doc = await payload.create({
      collection: collection as CollectionSlug,
      data: data as Record<string, unknown>,
      depth: 0,
    });
    return doc as T;
  } catch (error) {
    throw asCmsError(error);
  }
}

/** Create a document in an upload collection, bytes and all. */
export async function cmsUpload<T>(
  collection: string,
  file: { bytes: Uint8Array<ArrayBuffer>; fileName: string; mimeType: string },
  data: unknown = {},
): Promise<T> {
  try {
    const payload = await cms();
    const doc = await payload.create({
      collection: collection as CollectionSlug,
      data: data as Record<string, unknown>,
      file: {
        data: Buffer.from(file.bytes),
        name: file.fileName,
        mimetype: file.mimeType,
        size: file.bytes.byteLength,
      },
      depth: 0,
    });
    return doc as T;
  } catch (error) {
    throw asCmsError(error);
  }
}

export async function cmsDelete(collection: string, id: number | string): Promise<void> {
  try {
    const payload = await cms();
    await payload.delete({ collection: collection as CollectionSlug, id, depth: 0 });
  } catch (error) {
    throw asCmsError(error);
  }
}

/**
 * Delete a document as the staff member driving the browser, with access
 * rules enforced — deleting from the registry is deliberately reserved to a
 * logged-in admin (see the access rules on the registry collections).
 * Returns whether it worked, because the caller is usually cleaning up after
 * an error it is already reporting and must not throw a second one over it.
 */
export async function cmsDeleteAs(
  collection: string,
  id: number | string,
  cookie: string,
): Promise<boolean> {
  if (!cookie) return false;
  try {
    const payload = await cms();
    const { user } = await payload.auth({ headers: new Headers({ cookie: headerSafe(cookie) }) });
    if (!user) return false;
    await payload.delete({
      collection: collection as CollectionSlug,
      id,
      depth: 0,
      user,
      overrideAccess: false,
    });
    return true;
  } catch {
    return false;
  }
}

export async function cmsUpdate<T>(
  collection: string,
  id: number | string,
  data: unknown,
): Promise<T> {
  try {
    const payload = await cms();
    const doc = await payload.update({
      collection: collection as CollectionSlug,
      id,
      data: data as Record<string, unknown>,
      depth: 0,
    });
    return doc as T;
  } catch (error) {
    throw asCmsError(error);
  }
}

/**
 * Who the caller is logged in as in the CMS admin, or null for nobody —
 * what the staff-only routes are gated on.
 */
export async function cmsMe(
  cookie: string,
): Promise<{ id: number | string; email: string } | null> {
  if (!cookie) return null;
  try {
    const payload = await cms();
    const { user } = await payload.auth({ headers: new Headers({ cookie: headerSafe(cookie) }) });
    return user ? { id: user.id, email: user.email ?? "" } : null;
  } catch {
    return null;
  }
}
