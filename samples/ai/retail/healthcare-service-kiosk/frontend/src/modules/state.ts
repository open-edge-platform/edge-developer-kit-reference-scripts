// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { publicEnv } from "@/lib/public-config";
import { dependentsIn, enabledIn, type ModuleSwitches } from "./graph";
import { MODULES } from "./manifest";

/**
 * Which modules this terminal runs: config.yaml `modules.only` (keep just
 * these, with what they need) and `modules.disabled` (switch these off).
 * Browser-visible, so the touch menu and chat chips follow the same switch
 * as the server. Read at render or request time, never at module scope.
 */

export type { ModuleSwitches };

export const needsOf = (id: string): string[] => MODULES.find((m) => m.id === id)?.requires ?? [];

export const dependentsOf = (id: string): string[] => dependentsIn(MODULES, id);

const list = (key: string): string[] =>
  (publicEnv(key) ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

export function moduleSwitches(): ModuleSwitches {
  return {
    only: list("NEXT_PUBLIC_KIOSK_MODULES_ONLY"),
    disabled: list("NEXT_PUBLIC_KIOSK_MODULES_DISABLED"),
  };
}

/** A predicate over module ids for one reading of the switches. */
export const enabledModules = (switches: ModuleSwitches = moduleSwitches()): ((id: string) => boolean) =>
  enabledIn(MODULES, switches);

export const moduleEnabled = (id: string): boolean => enabledModules()(id);
