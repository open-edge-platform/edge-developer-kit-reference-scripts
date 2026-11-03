// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { healthAnswer } from "../../_lib/grounded";
import { badRequest, readJson } from "../../_lib/http";
import { moduleOff } from "../../_lib/modules";

/** POST /api/answers/health {question} — general health information from the patient guide, with red flags first. */
export async function POST(req: Request) {
  const off = moduleOff("healthqa");
  if (off) return off;
  const { question } = await readJson<{ question: string }>(req);
  if (typeof question !== "string" || !question.trim()) return badRequest("question is required");
  return Response.json(await healthAnswer(question));
}
