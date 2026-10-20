// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { packId } from ".";
import { chains as malaysiaChains } from "./malaysia/chains";

// Server-only half of the pack registry — chain planners hit the citizen
// registry and must never enter the client bundle.
const CHAINS: Record<string, Record<string, ChainSpec>> = {
  malaysia: malaysiaChains,
};

export function activeChains(): Record<string, ChainSpec> {
  return CHAINS[packId()] ?? CHAINS.malaysia;
}
