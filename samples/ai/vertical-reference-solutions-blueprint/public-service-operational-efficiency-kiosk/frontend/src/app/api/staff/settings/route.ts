// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readJson } from "../../_lib/http";
import {
  readSettings,
  SettingsError,
  writeSettings,
  writeSettingsText,
} from "../../_lib/settings";
import { notStaff, staffUser } from "../../_lib/staff";

// Staff-only, on the CMS admin session — see ../../_lib/staff. The file
// these edit decides which services the terminal talks to, so it is gated
// exactly like the registry.

const failed = (error: unknown): Response => {
  if (error instanceof SettingsError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  throw error;
};

export async function GET(req: Request) {
  if (!(await staffUser(req))) return notStaff();
  try {
    return Response.json(readSettings(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return failed(error);
  }
}

/** `values` writes form fields; `text` replaces the whole file. */
export async function PUT(req: Request) {
  if (!(await staffUser(req))) return notStaff();
  const body = await readJson<{ values: Record<string, string>; text: string }>(req);
  try {
    if (typeof body.text === "string") return Response.json(writeSettingsText(body.text));
    if (body.values && typeof body.values === "object") {
      return Response.json(writeSettings(body.values));
    }
    return Response.json({ error: "send either values or text" }, { status: 400 });
  } catch (error) {
    return failed(error);
  }
}
