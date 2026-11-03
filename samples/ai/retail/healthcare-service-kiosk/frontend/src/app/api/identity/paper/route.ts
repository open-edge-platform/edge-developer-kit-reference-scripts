// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { conflict, notFound, param, unavailable } from "../../_lib/http";
import { PAPER_FAILURE_MESSAGE, paperMode, readIdentityPaper, waitForPaper } from "../../_lib/identity-paper";

/** One long-poll of `?watch=1`; the page asks again when it comes back empty. */
const WATCH_MS = 25_000;

/** GET `{ mode }`; `?watch=1[&rearm=1]` long-polls for paper in the feeder. */
export async function GET(req: Request) {
  const mode = await paperMode();
  if (param(req, "watch") !== "1") {
    return Response.json({ mode }, { headers: { "cache-control": "no-store" } });
  }
  if (mode !== "sensor" && mode !== "simulated") {
    return conflict("this kiosk can't tell when paper is fed in — scan on request", { mode });
  }
  const fed = await waitForPaper(mode, WATCH_MS, req.signal, param(req, "rearm") === "1");
  return fed ? Response.json({ fed: true }) : new Response(null, { status: 204 });
}

/** POST — scan and OCR the page; the record it names goes to /api/identity/document. */
export async function POST() {
  const read = await readIdentityPaper();
  if (read.ok) return Response.json({ found: read.identity.kind });
  const message = PAPER_FAILURE_MESSAGE[read.reason];
  return read.reason === "off" || read.reason === "scan_failed" || read.reason === "unreadable"
    ? unavailable(message, { reason: read.reason })
    : notFound(message, { reason: read.reason });
}
