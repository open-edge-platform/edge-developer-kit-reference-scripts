// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services";

/** Every service's step map, rendered for the single-turn agent prompt
 *  (`agent.turns: single`) in place of the catalog tools. Fields come from
 *  each service's own `fields`/`briefingNotes`, so a changed service briefs itself. */

function documentLines(service: ServiceDefinition): string[] {
  return service.documents.map((doc) => {
    const fallback = doc.relationshipProof
      ? ` (a ${doc.relationshipProof.label} may prove a family link when it names another person)`
      : "";
    return `${doc.label} — ${doc.hint}${fallback}`;
  });
}

function serviceBlock(service: ServiceDefinition): string {
  const lines = [
    `- ${service.id}: ${service.label} — ${service.description}`,
    `  Steps: ${service.flow.join(" → ")}`,
  ];
  const fields = service.fields ?? [];
  if (fields.length > 0) {
    lines.push("  Application fields to collect:");
    for (const field of fields) lines.push(`    · ${field.id} — ${field.briefing}`);
  } else if (service.flow.includes("application")) {
    lines.push("  Application fields: decided by the flow from the citizen's records.");
  }
  for (const note of service.briefingNotes ?? []) {
    lines.push(`  ${note}`);
  }
  const documents = documentLines(service);
  if (documents.length > 0) {
    lines.push("  Documents (PDF uploads):");
    for (const doc of documents) lines.push(`    · ${doc}`);
  }
  return lines.join("\n");
}

/** Every service's id, label, step chain, fields and documents — the whole
 *  kiosk, pre-briefed. The catalog is passed in (rather than imported) so
 *  this stays loadable outside the bundler, where require.context is absent. */
export function singleTurnServiceBriefing(services: ServiceDefinition[]): string {
  return services.map(serviceBlock).join("\n");
}
