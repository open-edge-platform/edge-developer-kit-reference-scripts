// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { DocumentReader } from "@/app/api/_lib/document-text";
import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { getService } from "@/services";
import { packId } from ".";
import { server as malaysiaServer } from "./malaysia/server";

/** A pack's server half: the planners and document readers inside its service folders. */
export type PackServer = {
  /** The service folder's chain.ts planner, if it has one. */
  chain(dir: string): Promise<ChainSpec | undefined>;
  /** The service folder's read.ts readers, keyed by document requirement id. */
  readers(dir: string): Promise<Record<string, DocumentReader>>;
};

// Server-only half of the pack registry — chain planners hit the citizen
// registry and must never enter the client bundle.
const SERVERS: Record<string, PackServer> = {
  malaysia: malaysiaServer,
};

const activeServer = (): PackServer => SERVERS[packId()] ?? SERVERS.malaysia;

/** The chain of a service this terminal offers; none for one switched off or removed. */
export async function chainFor(serviceId: string): Promise<ChainSpec | undefined> {
  const dir = getService(serviceId)?.dir;
  return dir ? activeServer().chain(dir) : undefined;
}

/** The reader a service has for one of its documents, if any. */
export async function readerFor(
  serviceId: string,
  documentId: string,
): Promise<DocumentReader | undefined> {
  const dir = getService(serviceId)?.dir;
  return dir ? (await activeServer().readers(dir))[documentId] : undefined;
}
