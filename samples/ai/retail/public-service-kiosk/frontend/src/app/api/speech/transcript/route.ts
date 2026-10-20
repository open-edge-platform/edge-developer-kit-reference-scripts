// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, readJson } from "../../_lib/http";
import { finishTranscript } from "../../_lib/speech";

/**
 * A streamed utterance, finished like an uploaded clip: the browser posts
 * the worker's `text`, the session's current `language` and, when the worker
 * reported one, the language it `heard`; the reply is `{ text, language }`
 * with the language settled and the local terms repaired.
 */
export async function POST(req: Request) {
  const body = await readJson<{ text: unknown; language: unknown; heard: unknown }>(req);
  if (typeof body.text !== "string" || !body.text.trim()) {
    return badRequest("text is required");
  }
  const language = typeof body.language === "string" ? body.language : undefined;
  const heard = typeof body.heard === "string" ? body.heard : undefined;
  return Response.json(await finishTranscript(body.text.trim(), language, heard));
}
