// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { FlowRoute } from "@/app/api/_lib/flows/types";
import type { KioskFlowActions } from "@/hooks/use-kiosk-flow";
import type { ServiceDefinition } from "@/services/types";
import { enabledModules } from "./state";

/** A home-screen tile with a panel of its own that starts one service (Find your way → Indoor Navigation). */
export type HomePanel = {
  id: string;
  /** Left out while this service is switched off or removed. */
  service: string;
  title: string;
  detail: string;
  icon: LucideIcon;
  Panel: ComponentType<{ service: ServiceDefinition; actions: KioskFlowActions }>;
};

/** What a module adds to screens it does not own. */
export type Slots = {
  /** A terminal mode besides touch, offered by the mode toggle and `terminal.mode`. */
  modes: { id: string; Kiosk: ComponentType }[];
  homePanels: HomePanel[];
  /** Drawn under an assistant reply that carries a route. */
  routeCards: ComponentType<{ route: FlowRoute }>[];
};

/** Default export of a `slots.tsx` under src/components; `module` names the switch that turns it off. */
export type SlotFile = { module?: string; slots: Partial<Slots> };

// Found by name, so deleting a feature's folder takes its slots with it. Loaded
// on first use: a slot file imports screens that read slots themselves.
const slotCtx = require.context("../components", true, /\/slots\.tsx$/);

let files: SlotFile[] | undefined;

/** The slots enabled modules fill; read during render, like every switch. */
export function slotsOf<K extends keyof Slots>(name: K): Slots[K] {
  files = files ?? slotCtx.keys().map((key) => slotCtx<{ default: SlotFile }>(key).default);
  const on = enabledModules();
  return files
    .filter((file) => !file.module || on(file.module))
    .flatMap((file) => (file.slots[name] ?? []) as unknown[]) as Slots[K];
}
