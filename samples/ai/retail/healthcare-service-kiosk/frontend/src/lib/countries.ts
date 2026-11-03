// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { activePack } from "@/packs";

export const countries = (): readonly string[] => activePack().countries;

export const defaultCountry = (): string => countries()[0];

export const isSupportedCountry = (country: string): boolean => countries().includes(country);

/** "Malaysia or Vietnam" — for validation messages. */
export const countryList = (): string => {
  const all = countries();
  return all.length > 1 ? `${all.slice(0, -1).join(", ")} or ${all[all.length - 1]}` : all[0];
};
