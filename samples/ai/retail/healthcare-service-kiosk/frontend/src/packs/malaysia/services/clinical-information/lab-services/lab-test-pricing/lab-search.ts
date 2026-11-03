// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { completeJson, withinDeadline } from "@/app/api/_lib/llm-json";
import { LAB_TESTS, type LabTest } from "@/hospital/data";
import { searchTests } from "./lab-price";

const PickSchema = z.object({ testId: z.string() });

const SYSTEM =
  "You match a patient's words to a hospital laboratory's test catalog. Reply with a single JSON object and nothing else.";

/** The catalog search, and when it finds nothing the model's reading of the words — only ever an id from the catalog. */
export async function matchTests(query: string): Promise<{ tests: LabTest[]; aiAssisted: boolean }> {
  const found = searchTests(query);
  if (found.length > 0 || !query.trim()) return { tests: found, aiAssisted: false };
  const catalog = LAB_TESTS.map((t) => `${t.id}: ${t.name} (${t.keywords.join(", ")})`).join("\n");
  const reply = await withinDeadline(
    completeJson(
      SYSTEM,
      [
        "Catalog:",
        catalog,
        "",
        `The patient asked about: "${query.slice(0, 200)}"`,
        'Return {"testId": "<the catalog id they most likely mean>"}, or {"testId": "none"} when no test fits.',
      ].join("\n"),
      PickSchema,
    ),
  );
  const test = LAB_TESTS.find((t) => t.id === reply?.testId);
  return { tests: test ? [test] : [], aiAssisted: Boolean(test) };
}
