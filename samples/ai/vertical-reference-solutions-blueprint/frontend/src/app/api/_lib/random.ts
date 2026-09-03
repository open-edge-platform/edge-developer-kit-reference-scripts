// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { randomInt as cryptoRandomInt } from "node:crypto";

/** Crypto-backed integer in [0, bound), for identifiers and picks. */
export function randomInt(bound: number): number {
  return cryptoRandomInt(bound);
}
