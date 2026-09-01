// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { activePack } from "@/packs";

export const COUNTRIES: readonly string[] = activePack().countries;

export const DEFAULT_COUNTRY: string = COUNTRIES[0];

export const isSupportedCountry = (country: string): boolean => COUNTRIES.includes(country);

/** "Malaysia or Vietnam" — for validation messages. */
export const countryList = (): string =>
  COUNTRIES.length > 1
    ? `${COUNTRIES.slice(0, -1).join(", ")} or ${COUNTRIES[COUNTRIES.length - 1]}`
    : COUNTRIES[0];
