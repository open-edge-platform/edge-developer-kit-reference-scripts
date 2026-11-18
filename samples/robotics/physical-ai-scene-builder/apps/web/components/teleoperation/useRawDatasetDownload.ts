// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useRef, useState } from 'react';

import { readJsonBody, requestError, requestErrorFromBody } from '@/lib/http/requestError';

interface FileSystemWritableFileStream extends WritableStream<Uint8Array> {
  write(data: BufferSource | Blob | string): Promise<void>;
}

interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle>;
  }
}

function responseFilename(response: Response): string {
  const disposition = response.headers.get('content-disposition');
  const match = disposition?.match(/filename="([^"]+)"/i);
  return match?.[1] ?? 'robotic-studio-raw-dataset-and-training-v2.zip';
}

// Preparation and download of a 100+ GB dataset legitimately take hours, so there is no total
// deadline. Instead the flow is aborted only when neither the server-reported preparation
// progress nor the download stream has advanced for this long.
const STALL_TIMEOUT_MS = 5 * 60 * 1_000;
const STALL_CHECK_INTERVAL_MS = 5_000;

export type RawDatasetStatus = 'idle' | 'preparing' | 'downloading' | 'complete';
export type RawDatasetPhase =
  'checking-cache' | 'generating-training-environment' | 'archiving' | 'complete';

/**
 * Why a raw dataset download ended early. `cancelled` was the user's choice; `stalled` means no
 * progress for STALL_TIMEOUT_MS; `failed` carries the underlying error (a RequestError for HTTP
 * failures, so callers can tell a 409 "not ready yet" from a server fault).
 */
export type RawDatasetFailure =
  | { kind: 'cancelled'; message: string }
  | { kind: 'stalled'; message: string }
  | { kind: 'failed'; reason: unknown };

export interface RawDatasetDownloadState {
  status: RawDatasetStatus;
  phase: RawDatasetPhase;
  bytes: number;
  total: number | null;
  downloading: boolean;
  download: () => Promise<void>;
  cancel: () => Promise<void>;
}

export function useRawDatasetDownload(
  rawDatasetUrl: string,
  canDownload: boolean,
  onFailure: (failure: RawDatasetFailure) => void,
): RawDatasetDownloadState {
  const [status, setStatus] = useState<RawDatasetStatus>('idle');
  const [phase, setPhase] = useState<RawDatasetPhase>('checking-cache');
  const [bytes, setBytes] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  const downloading = status === 'preparing' || status === 'downloading';

  async function download(): Promise<void> {
    if (!canDownload || !rawDatasetUrl || downloading) return;
    // Request the save destination first, while the click's user-activation is still fresh -
    // the picker requires it, and preparation below can take minutes.
    let fileHandle: FileSystemFileHandle | null = null;
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: 'robotic-studio-raw-dataset-and-training-v2.zip',
        });
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        // Fall back to the browser's own download flow if the picker itself failed.
      }
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    cancelledRef.current = false;
    let stalled = false;
    let lastActivity = Date.now();
    const markActivity = (): void => {
      lastActivity = Date.now();
    };
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastActivity < STALL_TIMEOUT_MS) return;
      stalled = true;
      controller.abort();
    }, STALL_CHECK_INTERVAL_MS);
    setStatus('preparing');
    setPhase('checking-cache');
    setBytes(0);
    setTotal(null);
    try {
      const preparationResponse = await fetch(rawDatasetUrl, {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
      });
      const preparation = ((await readJsonBody(preparationResponse)) ?? {}) as {
        status?: 'preparing' | 'ready' | 'failed';
        phase?:
          | 'checking-cache'
          | 'generating-training-environment'
          | 'archiving'
          | 'complete'
          | 'failed';
        processedBytes?: number;
        totalBytes?: number | null;
        error?: string | null;
      };
      if (!preparationResponse.ok) {
        throw requestErrorFromBody(
          preparation,
          preparationResponse.status,
          'The raw dataset could not be prepared.',
        );
      }

      let current = preparation;
      let lastPhase = current.phase;
      let lastProcessedBytes = current.processedBytes;
      while (current.status === 'preparing') {
        if (
          current.phase === 'checking-cache' ||
          current.phase === 'generating-training-environment' ||
          current.phase === 'archiving' ||
          current.phase === 'complete'
        ) {
          setPhase(current.phase);
        }
        setBytes(current.processedBytes ?? 0);
        setTotal(current.totalBytes ?? null);
        await new Promise<void>((resolve) => window.setTimeout(() => resolve(), 500));
        const statusResponse = await fetch(
          `${rawDatasetUrl}${rawDatasetUrl.includes('?') ? '&' : '?'}status`,
          { cache: 'no-store', signal: controller.signal },
        );
        current = ((await readJsonBody(statusResponse)) ?? {}) as typeof current;
        if (!statusResponse.ok) {
          throw requestErrorFromBody(
            current,
            statusResponse.status,
            'The raw dataset preparation status could not be read.',
          );
        }
        if (current.status === 'failed') {
          throw new Error(current.error ?? 'The raw dataset could not be prepared.');
        }
        if (current.phase !== lastPhase || current.processedBytes !== lastProcessedBytes) {
          lastPhase = current.phase;
          lastProcessedBytes = current.processedBytes;
          markActivity();
        }
      }
      if (current.status !== 'ready') {
        throw new Error(current.error ?? 'The raw dataset could not be prepared.');
      }
      setPhase('complete');
      setBytes(current.processedBytes ?? 0);
      setTotal(current.totalBytes ?? null);

      markActivity();
      setStatus('downloading');
      setBytes(0);
      const response = await fetch(rawDatasetUrl, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw await requestError(response, 'The original dataset could not be downloaded.');
      }
      const totalHeader = response.headers.get('content-length');
      const parsedTotal = totalHeader ? Number(totalHeader) : Number.NaN;
      const totalBytes = Number.isSafeInteger(parsedTotal) && parsedTotal > 0 ? parsedTotal : null;
      setTotal(totalBytes);
      if (!response.body) {
        throw new Error('The raw dataset response had no readable body.');
      }
      let loaded = 0;
      const trackedBody = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, streamController) {
            markActivity();
            loaded += chunk.byteLength;
            setBytes(loaded);
            streamController.enqueue(chunk);
          },
        }),
      );
      if (fileHandle) {
        // Streams directly to disk with no in-memory buffering, so archive size is not
        // limited by tab memory - required for datasets in the tens/hundreds of GB.
        const writable = await fileHandle.createWritable();
        await trackedBody.pipeTo(writable);
      } else {
        const blob = await new Response(trackedBody).blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = responseFilename(response);
        anchor.style.display = 'none';
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      }
      setStatus('complete');
    } catch (reason) {
      setStatus('idle');
      if (cancelledRef.current) {
        onFailure({ kind: 'cancelled', message: 'The raw dataset preparation was cancelled.' });
      } else if (stalled) {
        onFailure({
          kind: 'stalled',
          message: 'The raw dataset preparation or download stopped making progress for 5 minutes.',
        });
      } else if (reason instanceof DOMException && reason.name === 'AbortError') {
        onFailure({ kind: 'cancelled', message: 'The raw dataset download was cancelled.' });
      } else {
        onFailure({ kind: 'failed', reason });
      }
    } finally {
      window.clearInterval(watchdog);
      controllerRef.current = null;
    }
  }

  async function cancel(): Promise<void> {
    if (!rawDatasetUrl || !downloading) return;
    cancelledRef.current = true;
    controllerRef.current?.abort();
    try {
      await fetch(rawDatasetUrl, { method: 'DELETE', cache: 'no-store' });
    } catch {
      // The local abort above already stops the client-side flow even if this request fails.
    }
  }

  return { status, phase, bytes, total, downloading, download, cancel };
}
