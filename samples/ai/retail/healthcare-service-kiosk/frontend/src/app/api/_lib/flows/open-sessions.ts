// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Flow state for the services anyone may use without identifying (a price,
 * directions, a question). Drafts live under a patient's document number, and
 * these flows have no patient, so their answers are kept here, in memory,
 * for as long as somebody might still be standing at the kiosk.
 */

const TTL_MS = 30 * 60_000;
const PREFIX = "OPEN-";

type OpenSession = { serviceId: string; data: Record<string, string>; at: number };

const SESSIONS = Symbol.for("kiosk.flows.openSessions");
type Global = { [SESSIONS]?: Map<string, OpenSession> };

function sessions(): Map<string, OpenSession> {
  const globals = globalThis as Global;
  return (globals[SESSIONS] ??= new Map());
}

function prune(now: number): void {
  for (const [id, session] of sessions()) {
    if (now - session.at > TTL_MS) sessions().delete(id);
  }
}

export const isOpenSession = (id: string | null | undefined): id is string => Boolean(id?.startsWith(PREFIX));

/** Saves the answers so far under `id`, or under a new id; returns the id. */
export function saveOpenSession(id: string | null, serviceId: string, data: Record<string, string>): string {
  const now = Date.now();
  prune(now);
  const key = isOpenSession(id) ? id : `${PREFIX}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  sessions().set(key, { serviceId, data: { ...data }, at: now });
  return key;
}

export function readOpenSession(id: string): OpenSession | null {
  const session = sessions().get(id);
  if (!session || Date.now() - session.at > TTL_MS) return null;
  return session;
}

export function dropOpenSession(id: string): void {
  sessions().delete(id);
}
