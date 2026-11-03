// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { enabledModules } from "@/modules/state";
import { packId } from "@/packs";
import type { CategoryDefinition, ServiceDefinition } from "./types";
import {
  CATEGORIES as MALAYSIA_CATEGORIES,
  SERVICES as MALAYSIA_SERVICES,
} from "@/packs/malaysia/catalog";

// Hand-written static imports, like src/packs/index.ts — register new packs'
// catalogs (src/packs/<country>/catalog.ts) here.
const CATALOGS: Record<string, { categories: CategoryDefinition[]; services: ServiceDefinition[] }> =
  {
    malaysia: { categories: MALAYSIA_CATEGORIES, services: MALAYSIA_SERVICES },
  };

const catalog = () => CATALOGS[packId()] ?? CATALOGS.malaysia;

/** Every service the pack ships, switched on or not — for the staff pages. */
export const allServices = (): ServiceDefinition[] => catalog().services;
export const allCategories = (): CategoryDefinition[] => catalog().categories;

/** The services this terminal offers: the pack's, minus any module switched off in config.yaml. */
export const services = (): ServiceDefinition[] => {
  const on = enabledModules();
  return catalog().services.filter((service) => on(service.id));
};

export const categories = (): CategoryDefinition[] => {
  const on = enabledModules();
  return catalog()
    .categories.map((category) => ({
      ...category,
      groups: category.groups
        .map((group) => ({ ...group, services: group.services.filter((service) => on(service.id)) }))
        .filter((group) => group.services.length > 0),
    }))
    .filter((category) => category.groups.length > 0);
};

export function getService(id: string): ServiceDefinition | null {
  return services().find((service) => service.id === id) ?? null;
}
