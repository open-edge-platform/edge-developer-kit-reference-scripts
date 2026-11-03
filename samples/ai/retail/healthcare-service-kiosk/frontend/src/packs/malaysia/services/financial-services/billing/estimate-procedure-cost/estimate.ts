// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { department, payer, PROCEDURES, type Procedure } from "@/hospital/data";
import type { ServiceResult } from "@/services/shared/result";

/** By id, or by the words of its name and clinic: "knee MRI", "brain scan". */
export function findProcedure(said: string): Procedure | undefined {
  const q = said.trim().toLowerCase();
  if (!q) return undefined;
  const exact = PROCEDURES.find((p) => p.id === q);
  if (exact) return exact;
  const typed = q.split(/[^a-z0-9]+/).filter((word) => word.length >= 2);
  const scored = PROCEDURES.map((p) => {
    const terms = `${p.name} ${department(p.department)?.name ?? ""}`.toLowerCase().split(/[^a-z0-9]+/);
    return { p, score: typed.filter((word) => terms.includes(word)).length };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.length && (scored.length === 1 || scored[0].score > scored[1].score) ? scored[0].p : undefined;
}

function standardTotal(procedure: Procedure): number {
  return procedure.charges.reduce((sum, c) => sum + c.amount, 0);
}

export function estimateResult(
  procedure: Procedure,
  payerId: string,
  money: (amount: number) => string,
): ServiceResult {
  const total = standardTotal(procedure);
  const rows = [
    ...procedure.charges.map((c) => ({ label: c.label, value: money(c.amount) })),
    { label: "Standard total", value: money(total) },
  ];
  const insurer = payerId !== "self" ? payer(payerId) : undefined;
  if (insurer) {
    const covered = Math.round((total * insurer.coveragePercent) / 100);
    rows.push(
      { label: `Covered by ${insurer.name} (${insurer.coveragePercent}%)`, value: money(covered) },
      { label: "Estimated co-pay", value: money(total - covered) },
    );
  }
  return {
    title: procedure.name,
    rows,
    note: "Estimate only — final charges depend on your treatment. Insurance cover is subject to a guarantee letter.",
  };
}
