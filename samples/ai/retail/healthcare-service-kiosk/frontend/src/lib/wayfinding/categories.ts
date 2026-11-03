// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CategoryDef } from "./types";

/** Built-in defaults; a map's `categories` block overrides/extends these. */
export const DEFAULT_CATEGORIES: Record<string, Required<CategoryDef>> = {
  default: { label: "Place", color: "#cbd5e1", icon: "📍" },
  shop: { label: "Shop", color: "#93c5fd", icon: "🛍️" },
  food: { label: "Food", color: "#fdba74", icon: "🍽️" },
  cafe: { label: "Cafe", color: "#fcd34d", icon: "☕" },
  health: { label: "Health", color: "#86efac", icon: "🩺" },
  restroom: { label: "Restroom", color: "#d1d5db", icon: "🚻" },
  service: { label: "Service", color: "#c4b5fd", icon: "🛎️" },
  entertainment: { label: "Entertainment", color: "#f9a8d4", icon: "🎬" },
  fitness: { label: "Fitness", color: "#6ee7b7", icon: "🏋️" },
  education: { label: "Education", color: "#a5b4fc", icon: "📚" },
  office: { label: "Office", color: "#bae6fd", icon: "🏢" },
  entrance: { label: "Entrance", color: "#34d399", icon: "🚪" },
  info: { label: "Information", color: "#60a5fa", icon: "ℹ️" },
  seating: { label: "Seating", color: "#fde68a", icon: "🪑" },
  parking: { label: "Parking", color: "#e5e7eb", icon: "🅿️" },
};

export const NODE_KIND_ICON: Record<string, string> = {
  stairs: "🪜",
  elevator: "🛗",
  escalator: "↗",
  entrance: "🚪",
  ramp: "♿",
};

export function resolveCategory(
  overrides: Record<string, CategoryDef> | undefined,
  key: string | undefined,
): Required<CategoryDef> {
  const base = DEFAULT_CATEGORIES[key ?? "default"] ?? DEFAULT_CATEGORIES.default;
  const o = key ? overrides?.[key] : undefined;
  return {
    label: o?.label ?? base.label,
    color: o?.color ?? base.color,
    icon: o?.icon ?? base.icon,
  };
}
