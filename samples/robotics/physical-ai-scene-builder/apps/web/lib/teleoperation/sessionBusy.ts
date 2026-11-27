// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { TeleoperationSessionSummary } from './sessionManager';

type BusyFields = Pick<TeleoperationSessionSummary, 'batch' | 'recording' | 'controlled'>;

/** What the running session is doing that starting another session would end, or null. */
export function busySessionReason(session: BusyFields): string | null {
  const batch = session.batch;
  if (batch?.status === 'running') {
    return `recording demonstrations (${batch.resolved ?? 0}/${batch.total ?? 0} done)`;
  }
  if (session.recording !== 'idle') return 'recording a demonstration';
  if (session.controlled)
    return 'connected to an external app, such as an evaluation or a Python script';
  return null;
}

/** Only one simulation runs at a time: explain what starting here would end. */
export function busySessionMessage(sceneName: string, reason: string): string {
  return (
    `"${sceneName}" is ${reason}. Only one scene can simulate at a time, so starting here ends ` +
    'it.'
  );
}

/** Raised instead of silently ending a session that is in use. */
export class SessionBusyError extends Error {
  readonly busy = true;
}

export function isSessionBusyError(value: unknown): value is SessionBusyError {
  return value instanceof SessionBusyError;
}
