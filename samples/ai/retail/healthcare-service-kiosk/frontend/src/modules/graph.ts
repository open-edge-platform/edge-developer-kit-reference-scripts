// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ModuleKind } from "./types";

// Type imports only: scripts/modules.mjs loads this file under plain Node.

type Linked = { id: string; kind: ModuleKind; requires?: string[] };

export type ModuleSwitches = { only: string[]; disabled: string[] };

export const dependentsIn = (modules: readonly Linked[], id: string): string[] =>
  modules.filter((m) => m.requires?.includes(id)).map((m) => m.id);

/** What `only` keeps: the listed modules and everything they need. */
export function keptBy(modules: readonly Linked[], only: string[]): Set<string> {
  const kept = new Set<string>();
  const visit = (id: string) => {
    if (kept.has(id)) return;
    kept.add(id);
    for (const need of modules.find((m) => m.id === id)?.requires ?? []) visit(need);
  };
  for (const id of only) visit(id);
  return kept;
}

/**
 * A predicate over module ids: on unless switched off, outside `only`, or
 * missing something it needs. A shared part also needs something that uses it.
 */
export function enabledIn(modules: readonly Linked[], switches: ModuleSwitches): (id: string) => boolean {
  const disabled = new Set(switches.disabled);
  const kept = switches.only.length > 0 ? keptBy(modules, switches.only) : null;
  const memo = new Map<string, boolean>();
  const on = (id: string): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, true);
    const spec = modules.find((m) => m.id === id);
    const result =
      !disabled.has(id) &&
      (!kept || kept.has(id)) &&
      (spec?.requires ?? []).every(on) &&
      (spec?.kind !== "shared" || dependentsIn(modules, id).some(on));
    memo.set(id, result);
    return result;
  };
  return on;
}
