// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export interface Obj2MjcfConversion {
  assetId: string;
  mjcf: string;
  files: string[];
}

export interface Obj2MjcfUploadResult extends Obj2MjcfConversion {
  /** Why the converted object could not be saved to the asset library, if it wasn't. */
  libraryError: string | null;
}

interface Obj2MjcfErrorResponse {
  errors?: { message?: string }[];
}

/** Uploads an OBJ + MTL + textures and runs `obj2mjcf` to get back an MJCF body and its assets. */
export async function convertObjToMjcf({
  obj,
  mtl,
  textures,
  name,
  category,
}: {
  obj: File;
  mtl: File;
  textures: readonly File[];
  /** Asset-library name; the OBJ filename is used when empty. */
  name?: string;
  category?: string;
}): Promise<Obj2MjcfUploadResult> {
  const body = new FormData();
  body.append('obj', obj);
  body.append('mtl', mtl);
  for (const texture of textures) body.append('textures', texture);
  const trimmedName = name?.trim();
  if (trimmedName) body.append('name', trimmedName);
  if (category) body.append('category', category);

  const controller = new AbortController();
  // obj2mjcf can take a while on large meshes (convex decomposition is optional and unused here).
  const timeout = window.setTimeout(() => controller.abort(), 120_000);
  let response: Response;
  try {
    response = await fetch('/api/assets/obj2mjcf', {
      method: 'POST',
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Converting this object is taking too long. Try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  const result = (await response.json()) as Partial<Obj2MjcfUploadResult> & Obj2MjcfErrorResponse;
  if (!response.ok) {
    throw new Error(result.errors?.[0]?.message ?? 'The object could not be converted.');
  }
  if (!result.assetId || !result.mjcf || !result.files) {
    throw new Error('The converted object was not returned. Try again.');
  }
  return {
    assetId: result.assetId,
    mjcf: result.mjcf,
    files: result.files,
    libraryError: result.libraryError ?? null,
  };
}

export function obj2mjcfFileUrl(assetId: string, filename: string): string {
  return `/api/assets/obj2mjcf/${encodeURIComponent(assetId)}/file/${encodeURIComponent(filename)}`;
}
