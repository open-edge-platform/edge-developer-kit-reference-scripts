// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { param } from "../../_lib/http";
import { readProgress } from "../../_lib/progress";

/**
 * Which phase the capture or check running under this trace id is in.
 *
 * Polled by the documents step every second or so while it waits, because
 * the work behind it is one long request that says nothing until it is
 * finished: a scan can spend half a minute waiting for paper and the check
 * that follows spends most of a minute in OCR. Without this the screen has
 * one spinner and one sentence for all of it, and the sentence is wrong for
 * most of the wait.
 *
 * A trace nobody is reporting on answers `{ phase: null }` — the work either
 * has not started yet or is already done, and neither is an error.
 */
export async function GET(req: Request) {
  const traceId = param(req, "traceId");
  return Response.json(readProgress(traceId) ?? { phase: null }, {
    headers: { "cache-control": "no-store" },
  });
}
