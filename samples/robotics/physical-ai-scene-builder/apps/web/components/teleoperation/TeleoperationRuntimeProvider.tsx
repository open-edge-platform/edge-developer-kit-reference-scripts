// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import type { RemoteSimulationSnapshot } from '@mujoco-studio/mujoco';
import { usePhysics } from '@mujoco-studio/mujoco';
import type {
  ModelRandomizationRuleV1,
  TeleoperationAttachmentDescriptorV1,
  TeleoperationRobotRandomizationV1,
  TeleoperationSourceRandomizationV1,
  TeleoperationStateSnapshotV1,
  TeleoperationStreamHeaderV1,
} from '@mujoco-studio/types';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { readJsonBody, requestErrorFromBody } from '@/lib/http/requestError';
import { URL_CHARS } from '@/lib/http/urlChars';
import type { TeleoperationBackdropRenderProgress } from '@/lib/teleoperation/backdropRender';
import type { TeleoperationSessionSummary } from '@/lib/teleoperation/sessionManager';
import { teleoperationProfilesMatch } from '@/lib/teleoperation/profile';
import type { EvaluationEpisodeSummary } from '@/lib/evaluation/sharedSession';

type TeleoperationRuntimeStatus =
  'idle' | 'starting' | 'connecting' | 'connected' | 'stale' | 'stopping' | 'error';

export interface TeleoperationSnapshot {
  header: TeleoperationStreamHeaderV1 &
    TeleoperationBackdropRenderProgress & {
      bodyNames?: string[];
      state?: number[];
      action?: number[];
      droppedMessages?: number;
      episode?: EvaluationEpisodeSummary;
    };
  attachments: Record<string, ArrayBuffer>;
}

interface TeleoperationRuntimeValue {
  status: TeleoperationRuntimeStatus;
  streaming: boolean;
  session: TeleoperationSessionSummary | null;
  snapshot: TeleoperationSnapshot | null;
  error: string | null;
  droppedMessages: number;
  lastMessageAt: number | null;
  prepareSession: (form: FormData) => Promise<TeleoperationSessionSummary>;
  startStream: () => Promise<void>;
  stopStream: () => Promise<void>;
  endSession: () => Promise<void>;
  setStreamReviewing: (reviewing: boolean) => void;
  applyReviewSnapshot: (snapshot: RemoteSimulationSnapshot) => void;
  refreshSession: () => Promise<TeleoperationSessionSummary | null>;
  updateEpisode: (
    episodeId: string,
    updates: { name?: string; notes?: string },
  ) => Promise<TeleoperationSessionSummary>;
  deleteEpisode: (episodeId: string) => Promise<TeleoperationSessionSummary>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<TeleoperationSessionSummary>;
  saveRecording: () => Promise<TeleoperationSessionSummary>;
  discardRecording: () => Promise<void>;
  appendState: (
    seed: number,
    sourceRandomization: TeleoperationSourceRandomizationV1,
    modelRandomization?: readonly ModelRandomizationRuleV1[],
    robotRandomization?: TeleoperationRobotRandomizationV1,
  ) => Promise<TeleoperationStateSnapshotV1>;
  selectState: (stateId: string) => Promise<void>;
  deleteState: (stateId: string) => Promise<TeleoperationSessionSummary>;
  restoreSelectedState: (releaseLeaseAfter?: boolean) => Promise<void>;
}

const TeleoperationRuntimeContext = createContext<TeleoperationRuntimeValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canReuseSession(
  existing: TeleoperationSessionSummary,
  requestedProfile: Record<string, unknown>,
): boolean {
  return teleoperationProfilesMatch(existing.profile, requestedProfile);
}

function arrayBufferFromBytes(
  bytes: ArrayBuffer,
  descriptor: TeleoperationAttachmentDescriptorV1,
): ArrayBuffer {
  if (descriptor.byteLength !== bytes.byteLength) {
    throw new Error(
      `Attachment '${descriptor.name}' has ${bytes.byteLength} bytes; expected ${descriptor.byteLength}.`,
    );
  }
  return bytes;
}

function float64ArrayFromBuffer(
  buffer: ArrayBuffer,
  descriptor: TeleoperationAttachmentDescriptorV1,
): Float64Array {
  if (descriptor.dtype !== 'float64' || descriptor.encoding !== 'raw-le') {
    throw new Error(`Attachment '${descriptor.name}' is not a raw little-endian float64 array.`);
  }
  const size = descriptor.shape.reduce((total, value) => total * value, 1);
  if (size * Float64Array.BYTES_PER_ELEMENT !== buffer.byteLength) {
    throw new Error(`Attachment '${descriptor.name}' shape does not match its byte length.`);
  }
  const values = new Float64Array(size);
  const view = new DataView(buffer);
  for (let index = 0; index < size; index++) values[index] = view.getFloat64(index * 8, true);
  return values;
}

async function readMessageBuffer(value: unknown): Promise<ArrayBuffer> {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return copy.buffer;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.arrayBuffer();
  throw new Error('Teleoperation stream returned an unsupported binary message.');
}

export function TeleoperationRuntimeProvider({ children }: { children: ReactNode }) {
  const {
    acquireExternalControl,
    applyRemoteSnapshot,
    getSimulation,
    holdsExternalControl,
    loadedSceneKey,
    releaseExternalControl,
  } = usePhysics();
  const streamAbortRef = useRef<AbortController | null>(null);
  const leaseRef = useRef<string | null>(null);
  const sessionRef = useRef<TeleoperationSessionSummary | null>(null);
  const previousSceneKeyRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const refreshPromiseRef = useRef<Promise<TeleoperationSessionSummary | null> | null>(null);
  const streamingRequestedRef = useRef(false);
  const reviewModeRef = useRef(false);
  const latestNativeSnapshotRef = useRef<RemoteSimulationSnapshot | null>(null);
  const connectStreamRef = useRef<(nextSession: TeleoperationSessionSummary) => void>(
    () => undefined,
  );
  const lastSequenceRef = useRef(0);
  const pendingHeaderRef = useRef<{
    header: TeleoperationSnapshot['header'];
    descriptors: TeleoperationAttachmentDescriptorV1[];
    buffers: ArrayBuffer[];
    discard: boolean;
  } | null>(null);
  const messageChainRef = useRef(Promise.resolve());
  const [status, setStatus] = useState<TeleoperationRuntimeStatus>('idle');
  const [streaming, setStreaming] = useState(false);
  const [session, setSession] = useState<TeleoperationSessionSummary | null>(null);
  const [snapshot, setSnapshot] = useState<TeleoperationSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [droppedMessages, setDroppedMessages] = useState(0);
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);

  const closeStream = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    pendingHeaderRef.current = null;
    messageChainRef.current = Promise.resolve();
  }, []);

  /**
   * The browser simulation lease, re-acquired when it was dropped: editing the scene in Build
   * reloads the simulation, which invalidates any lease held before the edit.
   */
  const currentLease = useCallback((): string => {
    const held = leaseRef.current;
    if (held && holdsExternalControl(held)) return held;
    const lease = acquireExternalControl();
    leaseRef.current = lease;
    return lease;
  }, [acquireExternalControl, holdsExternalControl]);

  const releaseLease = useCallback(() => {
    const lease = leaseRef.current;
    leaseRef.current = null;
    if (lease && holdsExternalControl(lease)) {
      try {
        releaseExternalControl(lease);
      } catch {
        // Scene replacement may already have invalidated the lease.
      }
    }
  }, [holdsExternalControl, releaseExternalControl]);

  const endSession = useCallback(async () => {
    const active = sessionRef.current;
    if (!active) return;
    setStatus('stopping');
    streamingRequestedRef.current = false;
    setStreaming(false);
    closeStream();
    releaseLease();
    refreshPromiseRef.current = null;
    reviewModeRef.current = false;
    latestNativeSnapshotRef.current = null;
    try {
      const response = await fetch(
        `/api/teleoperation/sessions?sessionId=${encodeURIComponent(active.sessionId)}`,
        { method: 'DELETE' },
      );
      if (!response.ok && response.status !== 404) {
        throw requestErrorFromBody(
          await readJsonBody(response),
          response.status,
          'The teleoperation session could not stop.',
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'The teleoperation session could not stop.',
      );
    } finally {
      sessionRef.current = null;
      setSession(null);
      setSnapshot(null);
      setStatus('idle');
    }
  }, [closeStream, releaseLease]);

  const handleStreamMessage = useCallback(
    async (value: unknown) => {
      if (typeof value === 'string') {
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          throw new Error('Teleoperation stream header was not valid JSON.');
        }
        if (
          !isRecord(parsed) ||
          parsed.messageType !== 'state' ||
          !Array.isArray(parsed.attachments)
        ) {
          throw new Error('Teleoperation stream header is invalid.');
        }
        const header = parsed as unknown as TeleoperationSnapshot['header'];
        if (header.protocolVersion !== 1)
          throw new Error('Teleoperation stream protocol is unsupported.');
        if (header.sessionId !== sessionRef.current?.sessionId)
          throw new Error('Teleoperation stream session changed.');
        if (header.sceneFingerprint !== sessionRef.current?.sceneFingerprint)
          throw new Error(
            'Teleoperation stream scene fingerprint does not match the active scene.',
          );
        const simulation = getSimulation();
        if (
          !simulation ||
          header.dimensions.nq !== simulation.nq ||
          header.dimensions.nv !== simulation.nv ||
          header.dimensions.nu !== simulation.nu
        ) {
          throw new Error('Teleoperation stream dimensions do not match the active scene.');
        }
        pendingHeaderRef.current = {
          header,
          descriptors: header.attachments,
          buffers: [],
          discard: header.sequence <= lastSequenceRef.current,
        };
        if (header.attachments.length === 0) {
          pendingHeaderRef.current = null;
          return;
        }
        return;
      }
      const pending = pendingHeaderRef.current;
      if (!pending) throw new Error('Teleoperation stream sent binary data without a header.');
      const buffer = await readMessageBuffer(value);
      const descriptor = pending.descriptors[pending.buffers.length];
      pending.buffers.push(arrayBufferFromBytes(buffer, descriptor));
      if (pending.buffers.length !== pending.descriptors.length) return;

      const attachments = Object.fromEntries(
        pending.descriptors.map((descriptor, index) => [descriptor.name, pending.buffers[index]]),
      );
      const current = pending.header;
      pendingHeaderRef.current = null;
      if (pending.discard) return;
      const byKind = new Map(
        current.attachments.map((descriptor, index) => [
          descriptor.kind,
          { descriptor, buffer: pending.buffers[index] },
        ]),
      );
      const qpos = byKind.get('qpos');
      const qvel = byKind.get('qvel');
      const ctrl = byKind.get('ctrl');
      if (!qpos || !qvel || !ctrl)
        throw new Error('Teleoperation snapshot is missing qpos, qvel, or ctrl.');
      const nextSnapshot: TeleoperationSnapshot = { header: current, attachments };
      const nativeSnapshot: RemoteSimulationSnapshot = {
        qpos: float64ArrayFromBuffer(qpos.buffer, qpos.descriptor),
        qvel: float64ArrayFromBuffer(qvel.buffer, qvel.descriptor),
        ctrl: float64ArrayFromBuffer(ctrl.buffer, ctrl.descriptor),
        simulationTime: current.simulationTime,
      };
      latestNativeSnapshotRef.current = nativeSnapshot;
      if (!leaseRef.current)
        throw new Error('Teleoperation stream has no browser simulation lease.');
      applyRemoteSnapshot(currentLease(), nativeSnapshot);
      lastSequenceRef.current = current.sequence;
      setSnapshot(nextSnapshot);
      setLastMessageAt(Date.now());
      setDroppedMessages(typeof current.droppedMessages === 'number' ? current.droppedMessages : 0);
      setError(null);
      setStatus('connected');
    },
    [applyRemoteSnapshot, currentLease, getSimulation],
  );

  const connectStream = useCallback(
    (nextSession: TeleoperationSessionSummary) => {
      setStatus('connecting');
      const controller = new AbortController();
      streamAbortRef.current = controller;
      void (async () => {
        try {
          const response = await fetch(
            `/api/teleoperation/sessions/${encodeURIComponent(nextSession.sessionId)}/stream`,
            { cache: 'no-store', signal: controller.signal },
          );
          if (!response.ok) {
            throw requestErrorFromBody(
              await readJsonBody(response),
              response.status,
              'The teleoperation stream could not connect.',
            );
          }
          if (!response.body) throw new Error('The teleoperation stream returned no data.');
          const reader = response.body.getReader();
          let pending = new Uint8Array();
          for (;;) {
            const result = await reader.read();
            if (result.done) break;
            const combined = new Uint8Array(pending.byteLength + result.value.byteLength);
            combined.set(pending);
            combined.set(result.value, pending.byteLength);
            pending = combined;
            while (pending.byteLength >= 5) {
              const payloadLength = new DataView(
                pending.buffer,
                pending.byteOffset,
                pending.byteLength,
              ).getUint32(1, true);
              if (payloadLength > 32 * 1024 * 1024) {
                throw new Error('The teleoperation stream message exceeds the browser limit.');
              }
              const frameLength = 5 + payloadLength;
              if (pending.byteLength < frameLength) break;
              const kind = pending[0];
              const payload = pending.slice(5, frameLength);
              pending = pending.slice(frameLength);
              if (kind === 0) {
                setError(null);
                setStatus('connected');
              } else if (kind === 1) {
                await handleStreamMessage(new TextDecoder().decode(payload));
              } else if (kind === 2) {
                await handleStreamMessage(payload.buffer);
              } else {
                throw new Error('The teleoperation stream message type is invalid.');
              }
            }
          }
          if (pending.byteLength > 0) {
            throw new Error('The teleoperation stream ended with an incomplete message.');
          }
          throw new Error('The teleoperation stream closed.');
        } catch (reason) {
          if (
            controller.signal.aborted ||
            streamAbortRef.current !== controller ||
            !streamingRequestedRef.current
          )
            return;
          streamAbortRef.current = null;
          setError(reason instanceof Error ? reason.message : 'The teleoperation stream failed.');
          setStatus('stale');
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;
            const active = sessionRef.current;
            if (active) connectStreamRef.current(active);
          }, 250);
        }
      })();
    },
    [handleStreamMessage],
  );

  useEffect(() => {
    connectStreamRef.current = connectStream;
  }, [connectStream]);

  const adoptPreparedSession = useCallback((nextSession: TeleoperationSessionSummary) => {
    reviewModeRef.current = false;
    latestNativeSnapshotRef.current = null;
    streamingRequestedRef.current = false;
    setStreaming(false);
    sessionRef.current = nextSession;
    setSession(nextSession);
    lastSequenceRef.current = 0;
    setStatus('idle');
  }, []);

  const prepareSession = useCallback(
    async (form: FormData): Promise<TeleoperationSessionSummary> => {
      setStatus('starting');
      setError(null);
      const profileValue = form.get('profile');
      let requestedProfile: Record<string, unknown> | null = null;
      if (typeof profileValue === 'string') {
        try {
          const parsed: unknown = JSON.parse(profileValue);
          requestedProfile = isRecord(parsed) ? parsed : null;
        } catch {
          requestedProfile = null;
        }
      }
      const current = sessionRef.current;
      if (current) {
        if (requestedProfile && canReuseSession(current, requestedProfile)) {
          return current;
        }
        if (current.recording !== 'idle' || streamingRequestedRef.current) {
          throw new Error(
            'Stop streaming and finish recording before changing the teleoperation camera profile.',
          );
        }
        await endSession();
      }
      const existingResponse = await fetch('/api/teleoperation/sessions', { cache: 'no-store' });
      if (existingResponse.ok) {
        const existing = (await readJsonBody(existingResponse)) as TeleoperationSessionSummary;
        if (requestedProfile && canReuseSession(existing, requestedProfile)) {
          adoptPreparedSession(existing);
          return existing;
        }
        if (existing.recording !== 'idle') {
          throw new Error(
            'Finish the active recording before changing the teleoperation camera profile.',
          );
        }
        const deleteResponse = await fetch(
          `/api/teleoperation/sessions?sessionId=${encodeURIComponent(existing.sessionId)}`,
          { method: 'DELETE' },
        );
        if (!deleteResponse.ok && deleteResponse.status !== 404) {
          throw requestErrorFromBody(
            await readJsonBody(deleteResponse),
            deleteResponse.status,
            'The previous teleoperation session could not stop.',
          );
        }
        sessionRef.current = null;
        setSession(null);
      } else if (existingResponse.status !== 404) {
        throw requestErrorFromBody(
          await readJsonBody(existingResponse),
          existingResponse.status,
          'The active teleoperation session could not be checked.',
        );
      }
      const response = await fetch('/api/teleoperation/sessions', { method: 'POST', body: form });
      const body = await readJsonBody(response);
      if (!response.ok) {
        setStatus('error');
        throw requestErrorFromBody(
          body,
          response.status,
          'The teleoperation session could not start.',
        );
      }
      const nextSession = body as TeleoperationSessionSummary;
      try {
        adoptPreparedSession(nextSession);
        return nextSession;
      } catch (reason) {
        await fetch(
          `/api/teleoperation/sessions?sessionId=${encodeURIComponent(nextSession.sessionId)}`,
          { method: 'DELETE', keepalive: true },
        ).catch(() => undefined);
        setStatus('error');
        throw reason;
      }
    },
    [adoptPreparedSession, endSession],
  );

  const startStream = useCallback(async (): Promise<void> => {
    const active = sessionRef.current;
    if (!active) throw new Error('Prepare the teleoperation session first.');
    closeStream();
    setError(null);
    streamingRequestedRef.current = true;
    reviewModeRef.current = false;
    setStreaming(true);
    lastSequenceRef.current = 0;
    try {
      currentLease();
      connectStream(active);
    } catch (reason) {
      streamingRequestedRef.current = false;
      setStreaming(false);
      setStatus('error');
      releaseLease();
      throw reason;
    }
  }, [closeStream, connectStream, currentLease, releaseLease]);

  const sessionRequest = useCallback(
    async (path: string, init?: RequestInit): Promise<TeleoperationSessionSummary> => {
      const active = sessionRef.current;
      if (!active) throw new Error('Start a teleoperation session first.');
      let url = '';
      for (const character of `/api/teleoperation/sessions/${encodeURIComponent(active.sessionId)}${path}`) {
        let allowedCharacter = '';
        for (const allowed of URL_CHARS) {
          if (allowed === character) {
            allowedCharacter = allowed;
            break;
          }
        }
        if (!allowedCharacter)
          throw new Error('The teleoperation session request is not supported.');
        url += allowedCharacter;
      }
      const response = await fetch(url, init);
      const body = await readJsonBody(response);
      if (!response.ok)
        throw requestErrorFromBody(
          body,
          response.status,
          'The teleoperation session request failed.',
        );
      const nextSession = body as TeleoperationSessionSummary;
      sessionRef.current = nextSession;
      setSession(nextSession);
      return nextSession;
    },
    [],
  );

  const refreshSession = useCallback(async (): Promise<TeleoperationSessionSummary | null> => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const active = sessionRef.current;
    if (!active) return null;
    const pending = (async () => {
      const response = await fetch(
        `/api/teleoperation/sessions?sessionId=${encodeURIComponent(active.sessionId)}`,
      );
      const body = await readJsonBody(response);
      if (!response.ok) {
        throw requestErrorFromBody(
          body,
          response.status,
          'The teleoperation session could not be refreshed.',
        );
      }
      const nextSession = body as TeleoperationSessionSummary;
      if (sessionRef.current?.sessionId !== active.sessionId) return null;
      sessionRef.current = nextSession;
      setSession(nextSession);
      return nextSession;
    })();
    refreshPromiseRef.current = pending;
    try {
      return await pending;
    } finally {
      if (refreshPromiseRef.current === pending) refreshPromiseRef.current = null;
    }
  }, []);

  const setStreamReviewing = useCallback(
    (reviewing: boolean) => {
      reviewModeRef.current = reviewing;
      if (reviewing || streamingRequestedRef.current) return;
      const latest = latestNativeSnapshotRef.current;
      if (leaseRef.current && latest) applyRemoteSnapshot(currentLease(), latest);
    },
    [applyRemoteSnapshot, currentLease],
  );

  const applyReviewSnapshot = useCallback(
    (nextSnapshot: RemoteSimulationSnapshot) => {
      applyRemoteSnapshot(currentLease(), nextSnapshot);
    },
    [applyRemoteSnapshot, currentLease],
  );

  const updateEpisode = useCallback(
    async (
      episodeId: string,
      updates: { name?: string; notes?: string },
    ): Promise<TeleoperationSessionSummary> => {
      return sessionRequest(`/episodes/${encodeURIComponent(episodeId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      });
    },
    [sessionRequest],
  );

  const deleteEpisode = useCallback(
    async (episodeId: string): Promise<TeleoperationSessionSummary> => {
      return sessionRequest(`/episodes/${encodeURIComponent(episodeId)}`, { method: 'DELETE' });
    },
    [sessionRequest],
  );

  const applyStateSnapshot = useCallback(
    (state: TeleoperationStateSnapshotV1) => {
      applyRemoteSnapshot(currentLease(), {
        qpos: Float64Array.from(state.qpos),
        qvel: Float64Array.from(state.qvel),
        ctrl: Float64Array.from(state.ctrl),
        simulationTime: 0,
      });
    },
    [applyRemoteSnapshot, currentLease],
  );

  const startRecording = useCallback(async () => {
    await sessionRequest('/recording', { method: 'POST' });
  }, [sessionRequest]);

  const stopRecording = useCallback(async (): Promise<TeleoperationSessionSummary> => {
    return sessionRequest('/recording', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });
  }, [sessionRequest]);

  const saveRecording = useCallback(async (): Promise<TeleoperationSessionSummary> => {
    return sessionRequest('/recording', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'save' }),
    });
  }, [sessionRequest]);

  const discardRecording = useCallback(async () => {
    await sessionRequest('/recording', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'discard' }),
    });
  }, [sessionRequest]);

  const appendState = useCallback(
    async (
      seed: number,
      sourceRandomization: TeleoperationSourceRandomizationV1,
      modelRandomization: readonly ModelRandomizationRuleV1[] = [],
      robotRandomization?: TeleoperationRobotRandomizationV1,
    ): Promise<TeleoperationStateSnapshotV1> => {
      const nextSession = await sessionRequest('/states', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          seed,
          sourceRandomization,
          ...(modelRandomization.length > 0 ? { modelRandomization } : {}),
          ...(robotRandomization ? { robotRandomization } : {}),
        }),
      });
      const state = nextSession.states.at(-1);
      if (!state) throw new Error('The randomized state response did not include a state.');
      applyStateSnapshot(state);
      return state;
    },
    [applyStateSnapshot, sessionRequest],
  );

  const selectState = useCallback(
    async (stateId: string) => {
      const nextSession = await sessionRequest(`/states/${encodeURIComponent(stateId)}`, {
        method: 'PUT',
      });
      const state = nextSession.states.find((candidate) => candidate.stateId === stateId);
      if (!state) throw new Error('The selected teleoperation state was not returned.');
      applyStateSnapshot(state);
    },
    [applyStateSnapshot, sessionRequest],
  );

  const deleteState = useCallback(
    async (stateId: string): Promise<TeleoperationSessionSummary> => {
      const wasActive = sessionRef.current?.activeStateId === stateId;
      const nextSession = await sessionRequest(`/states/${encodeURIComponent(stateId)}`, {
        method: 'DELETE',
      });
      if (wasActive) {
        const state = nextSession.states.find(
          (candidate) => candidate.stateId === nextSession.activeStateId,
        );
        if (!state) throw new Error('The active teleoperation state was not returned.');
        applyStateSnapshot(state);
      }
      return nextSession;
    },
    [applyStateSnapshot, sessionRequest],
  );

  const restoreSelectedState = useCallback(
    async (releaseLeaseAfter = false): Promise<void> => {
      const stateId = sessionRef.current?.activeStateId;
      if (!stateId) {
        if (releaseLeaseAfter) releaseLease();
        return;
      }
      try {
        await selectState(stateId);
      } finally {
        if (releaseLeaseAfter) releaseLease();
      }
    },
    [releaseLease, selectState],
  );

  const stopStream = useCallback(async (): Promise<void> => {
    const active = sessionRef.current;
    if (active) {
      const response = await fetch('/api/teleoperation/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: active.sessionId }),
      });
      if (!response.ok) {
        throw requestErrorFromBody(
          await readJsonBody(response),
          response.status,
          'The shared stream could not stop.',
        );
      }
      const updated = (await readJsonBody(response)) as TeleoperationSessionSummary;
      sessionRef.current = updated;
      setSession(updated);
    }
    streamingRequestedRef.current = false;
    setStreaming(false);
    setStatus('stopping');
    closeStream();
    releaseLease();
    reviewModeRef.current = false;
    latestNativeSnapshotRef.current = null;
    setSnapshot(null);
    setLastMessageAt(null);
    setError(null);
    setStatus('idle');
    if (!sessionRef.current?.pendingRecording) await restoreSelectedState(true);
  }, [closeStream, releaseLease, restoreSelectedState]);

  useEffect(() => {
    const previousSceneKey = previousSceneKeyRef.current;
    if (
      previousSceneKey &&
      loadedSceneKey &&
      previousSceneKey !== loadedSceneKey &&
      sessionRef.current
    ) {
      endSession();
    }
    previousSceneKeyRef.current = loadedSceneKey;
  }, [endSession, loadedSceneKey]);

  useEffect(() => {
    if (!session?.sessionId) return undefined;
    const timer = window.setInterval(() => {
      refreshSession().catch(() => undefined);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [refreshSession, session?.sessionId]);

  useEffect(() => {
    const onPageHide = () => {
      streamingRequestedRef.current = false;
      closeStream();
      releaseLease();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [closeStream, releaseLease]);

  useEffect(
    () => () => {
      closeStream();
      releaseLease();
    },
    [closeStream, releaseLease],
  );

  const value = useMemo<TeleoperationRuntimeValue>(
    () => ({
      status,
      streaming,
      session,
      snapshot,
      error,
      droppedMessages,
      lastMessageAt,
      prepareSession,
      startStream,
      stopStream,
      endSession,
      setStreamReviewing,
      applyReviewSnapshot,
      refreshSession,
      updateEpisode,
      deleteEpisode,
      startRecording,
      stopRecording,
      saveRecording,
      discardRecording,
      appendState,
      selectState,
      deleteState,
      restoreSelectedState,
    }),
    [
      appendState,
      deleteState,
      discardRecording,
      droppedMessages,
      endSession,
      setStreamReviewing,
      applyReviewSnapshot,
      error,
      lastMessageAt,
      saveRecording,
      selectState,
      restoreSelectedState,
      session,
      streaming,
      refreshSession,
      updateEpisode,
      deleteEpisode,
      snapshot,
      startRecording,
      prepareSession,
      startStream,
      status,
      stopStream,
      stopRecording,
    ],
  );

  return (
    <TeleoperationRuntimeContext.Provider value={value}>
      {children}
    </TeleoperationRuntimeContext.Provider>
  );
}

export function useTeleoperationRuntime(): TeleoperationRuntimeValue {
  const context = useContext(TeleoperationRuntimeContext);
  if (!context)
    throw new Error('useTeleoperationRuntime must be used inside a TeleoperationRuntimeProvider');
  return context;
}
