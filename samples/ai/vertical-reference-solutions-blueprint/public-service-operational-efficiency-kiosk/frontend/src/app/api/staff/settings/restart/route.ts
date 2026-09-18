// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { restartSupported, scheduleRestart } from "../../../_lib/restart";
import { notStaff, staffUser } from "../../../_lib/staff";

/** Start the kiosk again so a saved config.yaml is read — see ../../_lib/restart. */
export async function POST(req: Request) {
  if (!(await staffUser(req))) return notStaff();
  if (!restartSupported()) {
    return Response.json(
      {
        error: "this kiosk is not supervised — restart it by hand to apply the settings",
        reason: "manual",
      },
      { status: 409 },
    );
  }
  scheduleRestart();
  return Response.json({ restarting: true });
}
