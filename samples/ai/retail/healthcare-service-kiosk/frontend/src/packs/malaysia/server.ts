// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { DocumentReader } from "@/app/api/_lib/document-text";
import type { ChainSpec } from "@/app/api/_lib/flows/types";
import type { PackServer } from "../index.server";

// SERVER-ONLY — reached via src/packs/index.server.ts. A service's chain.ts and
// read.ts are found by name, so its folder is the whole registration.
// Loaded on first use, never at module scope: chain modules import back into
// the registry, and the ones that reach Payload are async modules.
const serverCtx = require.context("./services", true, /\/(chain|read)\.ts$/);

const loaded = new Map<string, Promise<unknown>>();

function load<T>(dir: string, file: "chain" | "read"): Promise<T | undefined> {
  const key = `./${dir}/${file}.ts`;
  if (!serverCtx.keys().includes(key)) return Promise.resolve(undefined);
  let pending = loaded.get(key);
  if (!pending) {
    pending = Promise.resolve(serverCtx(key));
    loaded.set(key, pending);
  }
  return pending as Promise<T>;
}

export const server: PackServer = {
  chain: async (dir) => (await load<{ chain?: ChainSpec }>(dir, "chain"))?.chain,
  readers: async (dir) =>
    (await load<{ readers?: Record<string, DocumentReader> }>(dir, "read"))?.readers ?? {},
};
