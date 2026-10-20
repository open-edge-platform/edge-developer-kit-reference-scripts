// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, notFound, oneOf, param } from "../../../_lib/http";
import {
  mockSets,
  renderDocument,
  VARIANTS,
  zipSets,
  type Variant,
} from "../../../_lib/mock-document-sets";
import { notStaff, staffUser } from "../../../_lib/staff";

// Staff-only, on the CMS admin session — see ../../../_lib/staff.

const SET_NAME: Record<Variant, string> = { good: "genuine", false: "tampered" };

const attachment = (bytes: Uint8Array, type: string, name: string, inline: boolean) =>
  new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": type,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "cache-control": "no-store",
    },
  });

/**
 * `citizen` + `variant` + `file` is one PDF (`inline=1` to open it in the
 * browser); without `file` it is that set as a zip, and without `variant`
 * both sets.
 */
export async function GET(req: Request) {
  if (!(await staffUser(req))) return notStaff();
  const id = Number(param(req, "citizen"));
  if (!Number.isInteger(id) || id <= 0) return badRequest("citizen must be a registry row id");

  let variant: Variant | null = null;
  if (param(req, "variant")) {
    const picked = oneOf(param(req, "variant"), VARIANTS, "variant");
    if (!picked.ok) return picked.response;
    variant = picked.value;
  }
  const file = param(req, "file");
  if (file && !variant) return badRequest("a file needs its variant");

  const sets = await mockSets(id);
  if (!sets) return notFound("nobody on the register has that id");
  if (variant === "false" && !sets.donor) {
    return notFound("a tampered set needs a second citizen on the register");
  }

  const slug = sets.holder.slug;
  if (file && variant) {
    const doc = await renderDocument(sets, variant, file);
    if (!doc) return notFound("this set has no such file");
    const name = `${slug}-${SET_NAME[variant]}-${doc.file}`;
    return attachment(doc.bytes, "application/pdf", name, param(req, "inline") === "1");
  }

  const bytes = await zipSets(sets, variant ? [variant] : VARIANTS);
  const name = `${slug}-${variant ? SET_NAME[variant] : "mock-documents"}.zip`;
  return attachment(bytes, "application/zip", name, false);
}
