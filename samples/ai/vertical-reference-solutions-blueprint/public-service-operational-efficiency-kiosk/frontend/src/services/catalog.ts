// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

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

export const categories = (): CategoryDefinition[] => catalog().categories;
export const services = (): ServiceDefinition[] => catalog().services;

export function getService(id: string): ServiceDefinition | null {
  return services().find((service) => service.id === id) ?? null;
}
