// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cmsMe } from "./cms";

/**
 * Who may use the registration desk.
 *
 * Every other route under /api is kiosk-facing: it answers a citizen standing
 * at the terminal, and it can only read the registry or add their own
 * application to it. The desk routes are the opposite — they create citizens
 * and bind cards to them, which is the one thing in this kit that decides who
 * somebody *is* — so they are not open to whoever can reach the terminal's
 * network.
 *
 * The gate is the CMS admin session the staff member already has: the browser
 * sends its Payload cookie, Payload says whose it is, and a route that gets
 * back nobody refuses. No second login, no second user table, and revoking a
 * staff account in the admin revokes the desk with it.
 */

export type StaffUser = { id: number | string; email: string };

/** The staff member behind this request, or null when nobody is logged in. */
export function staffUser(req: Request): Promise<StaffUser | null> {
  return cmsMe(req.headers.get("cookie") ?? "").catch(() => null);
}

/** 401 for a request with no admin session; identical wording on every route. */
export const notStaff = (): Response =>
  Response.json(
    { error: "sign in to the CMS admin to use the registration desk" },
    { status: 401 },
  );
