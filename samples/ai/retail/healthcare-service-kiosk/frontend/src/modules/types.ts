// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * "service"  one folder under src/packs/<pack>/services; listed in the manifest only to claim more.
 * "feature"  a capability with a switch of its own.
 * "shared"   code services need; it runs while one of them does and is removed with the last.
 */
export type ModuleKind = "service" | "feature" | "shared";

type ModuleBase = {
  id: string;
  /** Modules this one cannot run without. */
  requires?: string[];
  /** Files and folders that belong to this module alone, relative to the frontend root. A service's own folder is implied. */
  paths?: string[];
  /** npm packages nothing else imports. */
  packages?: string[];
  /** package.json scripts that belong to this module. */
  scripts?: string[];
};

/** A service's own label and description come from its service.ts. */
export type ModuleSpec =
  | (ModuleBase & { kind: "feature" | "shared"; title: string; summary: string })
  | (ModuleBase & { kind: "service" });

export type NamedModule = Extract<ModuleSpec, { kind: "feature" | "shared" }>;
