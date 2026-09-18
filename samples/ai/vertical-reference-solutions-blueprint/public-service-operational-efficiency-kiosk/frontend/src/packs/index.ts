// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { publicText } from "@/lib/public-config";
import type { CountryPack } from "./types";
import { malaysia } from "./malaysia/pack";
import { messages as malaysiaMessages } from "./malaysia/messages";

// Hand-written static imports, not folder discovery — register new packs here
// (Turbopack dedupes require.context on the same directory).
const PACKS: Record<string, CountryPack> = {
  malaysia,
};

/** Malaysia's catalog is the canonical key set every pack must cover. */
export type MessageKey = keyof typeof malaysiaMessages;

export const packId = (): string => publicText("NEXT_PUBLIC_KIOSK_PACK", "malaysia");

export function activePack(): CountryPack {
  const id = packId();
  const pack = PACKS[id];
  if (!pack) {
    throw new Error(
      `Unknown country pack "${id}" — expected one of: ${Object.keys(PACKS).join(", ")}`,
    );
  }
  return pack;
}

export type { CountryPack, LocaleMeta, Messages, PackIdDocument } from "./types";
