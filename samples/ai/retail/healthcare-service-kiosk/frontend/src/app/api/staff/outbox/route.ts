// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { sentNotices } from "../../_lib/notify";
import { notStaff, staffUser } from "../../_lib/staff";

// Staff-only, on the CMS admin session — see ../../_lib/staff.

/** GET — the messages this terminal sent, newest first, and where they went. */
export async function GET(req: Request) {
  if (!(await staffUser(req))) return notStaff();
  return Response.json(
    { driver: process.env.KIOSK_NOTIFY_DRIVER?.trim() || "outbox", notices: sentNotices() },
    { headers: { "cache-control": "no-store" } },
  );
}
