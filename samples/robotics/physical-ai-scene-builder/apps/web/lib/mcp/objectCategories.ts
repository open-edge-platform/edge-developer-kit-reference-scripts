// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Typical real-world physics for everyday objects, used by `set_object_physics` when an agent
 * names a category instead of measuring. Sizes are the largest side in meters; masses in kg;
 * friction is sliding friction against a table.
 */
export const OBJECT_CATEGORIES = {
  cube: { largestDimension: 0.05, mass: 0.1, friction: 1.0 },
  block: { largestDimension: 0.06, mass: 0.12, friction: 1.0 },
  box: { largestDimension: 0.12, mass: 0.15, friction: 0.8 },
  mug: { largestDimension: 0.1, mass: 0.3, friction: 0.9 },
  cup: { largestDimension: 0.09, mass: 0.05, friction: 0.8 },
  bowl: { largestDimension: 0.15, mass: 0.3, friction: 0.9 },
  plate: { largestDimension: 0.22, mass: 0.4, friction: 0.7 },
  bottle: { largestDimension: 0.2, mass: 0.3, friction: 0.8 },
  can: { largestDimension: 0.12, mass: 0.35, friction: 0.8 },
  ball: { largestDimension: 0.065, mass: 0.06, friction: 1.0 },
  fruit: { largestDimension: 0.08, mass: 0.15, friction: 1.0 },
  toy: { largestDimension: 0.08, mass: 0.05, friction: 0.9 },
  tool: { largestDimension: 0.18, mass: 0.15, friction: 0.8 },
} as const satisfies Record<string, { largestDimension: number; mass: number; friction: number }>;

export type ObjectCategory = keyof typeof OBJECT_CATEGORIES;
export const OBJECT_CATEGORY_NAMES = Object.keys(OBJECT_CATEGORIES) as [
  ObjectCategory,
  ...ObjectCategory[],
];
