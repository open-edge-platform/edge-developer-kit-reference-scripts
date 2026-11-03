// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { departmentLocation, LAB_TESTS, searchCatalog, type LabTest } from "@/hospital/data";
import type { ServiceResult } from "@/services/shared/result";

/** Edit distance, capped: a typo or two ("cholestrol", "thyriod") still finds the test. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const kept = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return row[b.length];
}

/** Words that name no test in particular. */
const FILLER = new Set(["test", "tests", "check", "level", "levels", "price", "cost", "much", "what", "does"]);

const words = (text: string) =>
  text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !FILLER.has(word));

/** Tests the words could mean: the catalog's names and keywords first, then near-misses of them. */
export function searchTests(query: string): LabTest[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact = LAB_TESTS.find((t) => t.id === q);
  if (exact) return [exact];
  const listed = searchCatalog(LAB_TESTS, query);
  if (listed.length > 0) return listed;
  const typed = words(q);
  return LAB_TESTS.filter((t) =>
    [...t.keywords, ...words(t.name)].some((term) =>
      typed.some((word) => term.length >= 4 && distance(word, term) <= (term.length >= 6 ? 2 : 1)),
    ),
  );
}

export function findTest(query: string): LabTest | undefined {
  return searchTests(query)[0];
}

export function labPriceResult(test: LabTest, money: (amount: number) => string): ServiceResult {
  return {
    title: test.name,
    rows: [
      { label: "Price", value: money(test.price) },
      { label: "Preparation", value: test.preparation },
      { label: "Results ready", value: test.turnaround },
      { label: "Where", value: departmentLocation("laboratory") },
    ],
    note: "Prices are estimates for self-paying patients; your insurance may cover part of it.",
  };
}
