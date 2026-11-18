// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { useCallback } from 'react';

import { useTeleoperationRuntime } from '../teleoperation/TeleoperationRuntimeProvider';
import { evaluationSessionSummary, sharedStreamProfile } from '@/lib/evaluation/sharedSession';
import { readJsonBody, requestErrorFromBody } from '@/lib/http/requestError';

export type { EvaluationEpisodeSummary } from '@/lib/evaluation/sharedSession';

/** Evaluation is a view of the shared recording/control runtime, not another worker or lease. */
export function useEvaluationRuntime() {
  const runtime = useTeleoperationRuntime();
  const { prepareSession, refreshSession, startStream } = runtime;
  const startStreaming = useCallback(
    async (form: FormData) => {
      const raw = form.get('profile');
      if (typeof raw !== 'string') throw new Error('A streaming profile is required.');
      const profile: unknown = JSON.parse(raw);
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        throw new Error('The streaming profile must be an object.');
      }
      form.set('profile', JSON.stringify(sharedStreamProfile(profile as Record<string, unknown>)));
      const session = await prepareSession(form);
      const response = await fetch('/api/evaluation/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, profile }),
      });
      if (!response.ok) {
        throw requestErrorFromBody(
          await readJsonBody(response),
          response.status,
          'The evaluation task could not be configured.',
        );
      }
      await refreshSession();
      await startStream();
    },
    [prepareSession, refreshSession, startStream],
  );
  return {
    status: runtime.status,
    streaming: runtime.streaming,
    session: runtime.session ? evaluationSessionSummary(runtime.session) : null,
    episode: runtime.snapshot?.header.episode ?? null,
    error: runtime.error,
    lastMessageAt: runtime.lastMessageAt,
    startStreaming,
    stopStreaming: runtime.stopStream,
  };
}
