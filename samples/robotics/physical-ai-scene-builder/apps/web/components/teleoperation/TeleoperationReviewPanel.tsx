// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import {
  TELEOPERATION_DEFAULT_STREAM_HZ,
  type TeleoperationEpisodeReviewV1,
  type TeleoperationEpisodeSummaryV1,
  type TeleoperationSceneVersionV1,
} from '@mujoco-studio/types';
import { Button, DeleteDialog, Dialog, useNotice } from '@mujoco-studio/ui';
import {
  Camera,
  CameraOff,
  Download,
  LineChart,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  StepBack,
  StepForward,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { EpisodeCameraPreviewStrip, EpisodeStateActionGraphs } from './EpisodeViewportOverlays';
import { useTeleoperationRuntime } from './TeleoperationRuntimeProvider';
import { noticeFromError } from '@/lib/notices';
import { useRawDatasetDownload, type RawDatasetFailure } from './useRawDatasetDownload';
import { episodeLabel, episodeSourcePath, formatBytes, formatDate } from './reviewUtils';

/** An earlier scene version shown read-only: its own episodes, images, and raw dataset. */
export interface ReviewVersionSource {
  collectionId: string;
  episodes: TeleoperationEpisodeSummaryV1[];
  streamHz: number;
}

export interface TeleoperationReviewPanelProps {
  /** Review an earlier scene version instead of the running session. */
  version?: ReviewVersionSource;
  /** Earlier versions whose episodes can be merged into the session's dataset download. */
  mergeableVersions?: readonly TeleoperationSceneVersionV1[];
  /** Viewport element the reviewed episode's camera frames are portaled into. */
  cameraPreviewHost?: HTMLDivElement | null;
  /** Viewport element the reviewed episode's state/action graphs are portaled into. */
  statsGraphsHost?: HTMLDivElement | null;
}

export function TeleoperationReviewPanel({
  version,
  mergeableVersions = [],
  cameraPreviewHost = null,
  statsGraphsHost = null,
}: TeleoperationReviewPanelProps = {}) {
  const {
    applyReviewSnapshot,
    deleteEpisode,
    refreshSession,
    restoreSelectedState,
    session,
    setStreamReviewing,
    snapshot,
    streaming,
    updateEpisode,
  } = useTeleoperationRuntime();
  const readOnly = Boolean(version);
  // The episode owner: the running session, or the earlier version being reviewed.
  const sourceId = version ? version.collectionId : (session?.sessionId ?? null);
  const source = useMemo(
    () =>
      !sourceId
        ? null
        : {
            id: sourceId,
            path: episodeSourcePath(
              readOnly ? { collectionId: sourceId } : { sessionId: sourceId },
            ),
          },
    [readOnly, sourceId],
  );
  const streamHz = version
    ? version.streamHz
    : (session?.streamHz ?? TELEOPERATION_DEFAULT_STREAM_HZ);
  // An earlier version's joint states belong to the earlier scene, so they are not replayed in
  // the viewport; its camera images and values still are.
  const liveStreaming = !readOnly && streaming;
  const [includeEarlierVersions, setIncludeEarlierVersions] = useState(false);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState('');
  const [review, setReview] = useState<TeleoperationEpisodeReviewV1 | null>(null);
  const [loadedReviewKey, setLoadedReviewKey] = useState<string | null>(null);
  const [episodeLoadProgress, setEpisodeLoadProgress] = useState<{
    loaded: number;
    total: number | null;
    elapsedMs: number;
  }>({ loaded: 0, total: null, elapsedMs: 0 });
  const [frameIndex, setFrameIndex] = useState(0);
  const frameIndexRef = useRef(frameIndex);
  const [playing, setPlaying] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showCameraPreview, setShowCameraPreview] = useState(false);
  const [showStatsGraphs, setShowStatsGraphs] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  // Background problems (episode loading, replay) stay inline next to the viewer; failures of
  // user actions open a notice dialog so they are not missed below the fold.
  const [error, setError] = useState<string | null>(null);
  const [rawDatasetNote, setRawDatasetNote] = useState<string | null>(null);
  const showNotice = useNotice();

  const episodes = version ? version.episodes : (session?.episodes ?? []);
  const selectedEpisode =
    episodes.find((episode) => episode.episodeId === selectedEpisodeId) ??
    episodes.find((episode) => episode.status === 'recorded' && episode.frameCount > 0) ??
    episodes[0];
  const activeEpisodeId = selectedEpisode?.episodeId ?? '';
  const reviewableCount = episodes.filter(
    (episode) => episode.status === 'recorded' && episode.frameCount > 0,
  ).length;
  const reviewKey = source && activeEpisodeId ? `${source.id}:${activeEpisodeId}` : '';
  const reviewMatchesSelection = loadedReviewKey === reviewKey;
  const activeReview = reviewMatchesSelection ? review : null;
  const currentFrame = activeReview?.frames[frameIndex];
  const loading = Boolean(
    selectedEpisode &&
    selectedEpisode.status === 'recorded' &&
    selectedEpisode.frameCount > 0 &&
    !reviewMatchesSelection,
  );
  const mergeable = mergeableVersions.filter((candidate) => candidate.episodeCount > 0);
  const mergedEpisodeCount = mergeable.reduce(
    (total, candidate) => total + candidate.episodeCount,
    0,
  );
  const merging = !readOnly && includeEarlierVersions && mergeable.length > 0;
  const canDownloadRawDataset = readOnly
    ? reviewableCount > 0
    : (reviewableCount > 0 || merging) &&
      session?.recording === 'idle' &&
      snapshot?.header.recording !== 'recording';
  const rawDatasetUrl = version
    ? `/api/teleoperation/versions/raw-dataset?versions=${encodeURIComponent(version.collectionId)}`
    : !session
      ? ''
      : merging
        ? `/api/teleoperation/versions/raw-dataset?versions=${[
            session.collectionId,
            ...mergeable.map((candidate) => candidate.collectionId),
          ]
            .map(encodeURIComponent)
            .join(',')}`
        : `/api/teleoperation/sessions/${encodeURIComponent(session.sessionId)}/raw-dataset`;
  const onRawDatasetFailure = (failure: RawDatasetFailure): void => {
    if (failure.kind === 'cancelled') {
      setRawDatasetNote(failure.message);
    } else if (failure.kind === 'stalled') {
      showNotice({
        tone: 'warning',
        title: 'Raw dataset download stalled',
        message: failure.message,
        hint: 'Check that the server is still running and has free disk space, then retry the download.',
      });
    } else {
      showNotice(
        noticeFromError(
          'Raw dataset not downloaded',
          failure.reason,
          'The raw dataset could not be downloaded.',
        ),
      );
    }
  };
  const rawDataset = useRawDatasetDownload(
    rawDatasetUrl,
    canDownloadRawDataset,
    onRawDatasetFailure,
  );

  const resetToSelectedState = useEffectEvent(() => {
    setPlaying(false);
    setReviewing(false);
    if (readOnly) return;
    restoreSelectedState(true).catch((reason: unknown) => {
      setError(
        reason instanceof Error
          ? reason.message
          : 'The selected scene state could not be restored.',
      );
    });
  });

  useEffect(() => {
    frameIndexRef.current = frameIndex;
  }, [frameIndex]);

  useEffect(() => {
    if (
      !source ||
      !activeEpisodeId ||
      selectedEpisode?.status !== 'recorded' ||
      selectedEpisode.frameCount < 1
    )
      return;
    const controller = new AbortController();
    const startedAt = performance.now();
    setEpisodeLoadProgress({ loaded: 0, total: null, elapsedMs: 0 });
    const elapsedTimer = window.setInterval(() => {
      setEpisodeLoadProgress((current) => ({
        ...current,
        elapsedMs: performance.now() - startedAt,
      }));
    }, 100);
    void (async () => {
      try {
        const response = await fetch(
          `${source.path}/episodes/${encodeURIComponent(activeEpisodeId)}`,
          { signal: controller.signal },
        );
        const totalHeader = response.headers.get('x-episode-size');
        const parsedTotal = totalHeader ? Number(totalHeader) : Number.NaN;
        const total = Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : null;
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let loaded = 0;
        let payload = '';
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            loaded += value.byteLength;
            payload += decoder.decode(value, { stream: true });
            setEpisodeLoadProgress({
              loaded,
              total,
              elapsedMs: performance.now() - startedAt,
            });
          }
          payload += decoder.decode();
        } else {
          payload = await response.text();
          loaded = new TextEncoder().encode(payload).byteLength;
        }
        let body: TeleoperationEpisodeReviewV1 & { error?: string };
        try {
          body = JSON.parse(payload) as TeleoperationEpisodeReviewV1 & { error?: string };
        } catch {
          throw new Error(
            response.ok
              ? 'The episode data could not be read.'
              : `The episode could not be loaded (HTTP ${response.status}).`,
          );
        }
        if (!response.ok) throw new Error(body.error ?? 'The episode could not be loaded.');
        if (controller.signal.aborted) return;
        setEpisodeLoadProgress({
          loaded,
          total,
          elapsedMs: performance.now() - startedAt,
        });
        setReview(body);
        setLoadedReviewKey(reviewKey);
        frameIndexRef.current = 0;
        setFrameIndex(0);
        setPlaying(false);
      } catch (reason) {
        if (!controller.signal.aborted) {
          setReview(null);
          setLoadedReviewKey(reviewKey);
          setError(reason instanceof Error ? reason.message : 'The episode could not be loaded.');
        }
      } finally {
        window.clearInterval(elapsedTimer);
      }
    })();
    return () => {
      controller.abort();
      window.clearInterval(elapsedTimer);
    };
  }, [
    activeEpisodeId,
    reviewKey,
    selectedEpisode?.frameCount,
    selectedEpisode?.status,
    source,
    liveStreaming,
  ]);

  useEffect(() => {
    if (liveStreaming || !playing || !activeReview || activeReview.frames.length < 2)
      return undefined;
    // Cameras are episode videos that seek to the shown frame, so frames advance on a timer.
    const frameIntervalMs = 1_000 / Math.max(streamHz, 1);
    let index = frameIndexRef.current >= activeReview.frames.length - 1 ? 0 : frameIndexRef.current;
    let nextDueAt = performance.now() + frameIntervalMs;
    let animationFrame = 0;
    const advance = (now: number) => {
      if (now < nextDueAt) {
        animationFrame = window.requestAnimationFrame(advance);
        return;
      }
      index += 1;
      frameIndexRef.current = index;
      setFrameIndex(index);
      if (index >= activeReview.frames.length - 1) {
        resetToSelectedState();
        return;
      }
      nextDueAt = performance.now() + frameIntervalMs;
      animationFrame = window.requestAnimationFrame(advance);
    };
    animationFrame = window.requestAnimationFrame(advance);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeReview, playing, streamHz, liveStreaming]);

  useEffect(() => {
    if (readOnly) return undefined;
    if (streaming) {
      setPlaying(false);
      setReviewing(false);
      return undefined;
    }
    setStreamReviewing(Boolean(activeReview) && reviewing);
    return () => setStreamReviewing(false);
  }, [activeReview, readOnly, reviewing, setStreamReviewing, streaming]);

  useEffect(() => {
    if (
      readOnly ||
      streaming ||
      !reviewing ||
      !activeReview ||
      !currentFrame?.qpos ||
      !currentFrame.qvel ||
      !currentFrame.ctrl
    )
      return;
    try {
      applyReviewSnapshot({
        qpos: currentFrame.qpos,
        qvel: currentFrame.qvel,
        ctrl: currentFrame.ctrl,
        simulationTime: currentFrame.timestamp,
      });
    } catch (reason) {
      queueMicrotask(() => {
        setError(
          reason instanceof Error ? reason.message : 'The replay frame could not be applied.',
        );
      });
    }
  }, [activeReview, applyReviewSnapshot, currentFrame, readOnly, reviewing, streaming]);

  const reviewEpisode = useMemo(
    () =>
      activeReview && selectedEpisode
        ? { ...activeReview.episode, ...selectedEpisode }
        : activeReview?.episode,
    [activeReview, selectedEpisode],
  );
  const episodeLoadPercentage = episodeLoadProgress.total
    ? Math.min(Math.round((episodeLoadProgress.loaded / episodeLoadProgress.total) * 100), 100)
    : null;
  const episodeLoadSeconds = (episodeLoadProgress.elapsedMs / 1_000).toFixed(1);
  // Only the live session's profile names each state/action dimension; an earlier version's
  // graphs fall back to generic labels inside EpisodeStateActionGraphs.
  const stateFieldNames = readOnly ? [] : (session?.profile.state.map((field) => field.name) ?? []);
  const actionFieldNames = readOnly
    ? []
    : (session?.profile.action.map((field) => field.name) ?? []);
  const downloadButtonLabel = rawDataset.downloading
    ? rawDataset.status === 'preparing'
      ? rawDataset.phase === 'generating-training-environment'
        ? 'Generating training environment...'
        : rawDataset.phase === 'archiving'
          ? 'Building archive...'
          : 'Preparing dataset...'
      : 'Downloading...'
    : 'Download dataset';

  if (!source) {
    return (
      <p className="border border-dashed border-border px-3 py-5 text-center text-[10px] leading-relaxed text-muted">
        Start streaming to load recorded episodes.
      </p>
    );
  }

  async function refreshEpisodes(): Promise<void> {
    setRefreshing(true);
    setError(null);
    try {
      await refreshSession();
    } catch (reason) {
      showNotice(
        noticeFromError('Episodes not refreshed', reason, 'Episodes could not be refreshed.'),
      );
    } finally {
      setRefreshing(false);
    }
  }

  function beginEdit(): void {
    if (!selectedEpisode) return;
    setDraftName(selectedEpisode.name ?? '');
    setDraftNotes(selectedEpisode.notes ?? '');
    setEditing(true);
  }

  async function saveMetadata(): Promise<void> {
    if (!selectedEpisode) return;
    setSaving(true);
    setError(null);
    try {
      await updateEpisode(selectedEpisode.episodeId, {
        name: draftName,
        notes: draftNotes,
      });
      setEditing(false);
    } catch (reason) {
      showNotice(
        noticeFromError(
          'Episode not updated',
          reason,
          'Episode metadata could not be saved.',
          'Your edits are still in the Edit episode dialog.',
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeEpisode(): Promise<void> {
    if (!selectedEpisode) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteEpisode(selectedEpisode.episodeId);
      setReview(null);
      setSelectedEpisodeId('');
      setDeleteDialogOpen(false);
    } catch (reason) {
      showNotice(
        noticeFromError('Episode not deleted', reason, 'The episode could not be deleted.'),
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        {!readOnly && mergeable.length > 0 && (
          <label className="mr-auto flex items-center gap-1.5 text-[10px] text-muted">
            <input
              aria-label="Include earlier versions in the download"
              checked={includeEarlierVersions}
              className="accent-accent"
              disabled={rawDataset.downloading}
              onChange={(event) => setIncludeEarlierVersions(event.target.checked)}
              type="checkbox"
            />
            Include {mergedEpisodeCount} episode{mergedEpisodeCount === 1 ? '' : 's'} from earlier
            versions
          </label>
        )}
        <Button
          aria-label={
            showCameraPreview
              ? 'Hide episode cameras in viewport'
              : 'Show episode cameras in viewport'
          }
          aria-pressed={showCameraPreview}
          onClick={() => setShowCameraPreview((value) => !value)}
          size="icon"
          title={
            showCameraPreview
              ? 'Hide episode cameras in viewport'
              : 'Show episode cameras in viewport'
          }
          variant={showCameraPreview ? 'primary' : 'outline'}
        >
          {showCameraPreview ? <Camera /> : <CameraOff />}
        </Button>
        <Button
          aria-label={
            showStatsGraphs ? 'Hide state and action graphs' : 'Show state and action graphs'
          }
          aria-pressed={showStatsGraphs}
          onClick={() => setShowStatsGraphs((value) => !value)}
          size="icon"
          title={showStatsGraphs ? 'Hide state and action graphs' : 'Show state and action graphs'}
          variant={showStatsGraphs ? 'primary' : 'outline'}
        >
          <LineChart />
        </Button>
        {!readOnly && (
          <Button
            aria-label="Refresh recorded episodes"
            className="gap-1.5"
            disabled={refreshing}
            onClick={() => void refreshEpisodes()}
            size="sm"
            title="Refresh recorded episodes"
            variant="primary"
          >
            <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
            Refresh
          </Button>
        )}
      </div>

      {episodes.length === 0 ? (
        <p className="border border-dashed border-border px-3 py-5 text-center text-[10px] leading-relaxed text-muted">
          {readOnly
            ? 'No episodes were recorded in this version.'
            : 'Episodes saved by the streaming client will appear here.'}
        </p>
      ) : (
        <>
          <select
            aria-label="Recorded episode"
            className="h-8 w-full border border-border bg-background px-2 text-[11px] text-foreground"
            value={activeEpisodeId}
            onChange={(event) => {
              setPlaying(false);
              setReviewing(true);
              setSelectedEpisodeId(event.target.value);
            }}
          >
            {episodes.map((episode) => (
              <option key={episode.episodeId} value={episode.episodeId}>
                {episodeLabel(episode)} · {episode.frameCount} frames · {episode.status}
              </option>
            ))}
          </select>

          {selectedEpisode && (
            <div className="border border-border bg-background px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-foreground">
                    {episodeLabel(selectedEpisode)}
                  </p>
                  <p className="mt-1 text-[9px] text-muted">
                    {selectedEpisode.frameCount} frames · {selectedEpisode.status} ·{' '}
                    {formatDate(selectedEpisode.endedAt ?? selectedEpisode.startedAt)}
                  </p>
                </div>
                {!readOnly && (
                  <>
                    <Button
                      aria-label="Edit episode metadata"
                      disabled={deleting}
                      onClick={beginEdit}
                      size="icon"
                      title="Edit episode metadata"
                      variant="ghost"
                    >
                      <Pencil />
                    </Button>
                    <Button
                      aria-label="Delete episode"
                      disabled={deleting}
                      onClick={() => setDeleteDialogOpen(true)}
                      size="icon"
                      title="Delete episode"
                      variant="ghost"
                    >
                      {deleting ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Trash2 className="text-danger" />
                      )}
                    </Button>
                  </>
                )}
              </div>
              {selectedEpisode.notes && (
                <p className="mt-2 border-t border-border pt-2 text-[10px] leading-relaxed text-muted">
                  {selectedEpisode.notes}
                </p>
              )}
            </div>
          )}

          {loading && (
            <div className="space-y-2 py-8" aria-live="polite" role="status">
              <div className="flex items-center justify-between gap-2 text-[10px] text-muted">
                <span className="flex items-center gap-2">
                  <LoaderCircle className="animate-spin" /> Loading episode
                </span>
                <span className="shrink-0 tabular-nums">
                  {episodeLoadPercentage === null ? '' : `${episodeLoadPercentage}% · `}
                  {episodeLoadSeconds}s
                </span>
              </div>
              <progress
                aria-label="Episode loading progress"
                className="h-1.5 w-full accent-accent"
                max={episodeLoadProgress.total ?? undefined}
                value={episodeLoadProgress.total ? episodeLoadProgress.loaded : undefined}
              />
            </div>
          )}
          {!loading && !activeReview && selectedEpisode?.status !== 'recorded' && (
            <p className="border border-dashed border-border px-3 py-5 text-center text-[10px] text-muted">
              This episode has no replayable frames.
            </p>
          )}
          {!loading && activeReview && currentFrame && reviewEpisode && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[9px] text-muted">
                <span>State {reviewEpisode.stateId}</span>
                <span className="text-right tabular-nums">{reviewEpisode.frameCount} frames</span>
                <span>
                  Frame {frameIndex + 1} / {activeReview.frames.length}
                </span>
                <span className="text-right tabular-nums">
                  {currentFrame.timestamp.toFixed(3)} s
                </span>
              </div>

              {activeReview.cameras.length === 0 && (
                <div className="border border-dashed border-border px-3 py-5 text-center text-[10px] text-muted">
                  No image data in this episode.
                </div>
              )}

              <input
                aria-label="Episode frame"
                className="w-full accent-accent"
                type="range"
                min={0}
                max={Math.max(activeReview.frames.length - 1, 0)}
                value={frameIndex}
                onChange={(event) => {
                  setPlaying(false);
                  setReviewing(true);
                  setFrameIndex(Number(event.target.value));
                }}
              />
              <div className="flex items-center justify-center gap-1.5">
                <Button
                  aria-label="Previous episode frame"
                  disabled={frameIndex === 0}
                  onClick={() => {
                    setPlaying(false);
                    setReviewing(true);
                    setFrameIndex(Math.max(0, frameIndex - 1));
                  }}
                  size="icon"
                  title="Previous episode frame"
                  variant="ghost"
                >
                  <StepBack />
                </Button>
                {/* Button has disabled:pointer-events-none, so its own title wouldn't show on hover; the
                    wrapping span keeps the hover target for the tooltip. */}
                <span title={liveStreaming ? 'Stop streaming to replay this episode' : undefined}>
                  <Button
                    aria-label={
                      liveStreaming
                        ? 'Stop streaming to replay this episode'
                        : playing
                          ? 'Pause episode replay'
                          : 'Play episode replay'
                    }
                    disabled={liveStreaming}
                    onClick={() => {
                      if (frameIndex >= activeReview.frames.length - 1) {
                        frameIndexRef.current = 0;
                        setFrameIndex(0);
                      }
                      setReviewing(true);
                      setPlaying((value) => !value);
                    }}
                    size="sm"
                    variant="primary"
                  >
                    {playing ? <Pause /> : <Play />}
                    {playing ? 'Pause' : 'Replay'}
                  </Button>
                </span>
                <Button
                  aria-label="Next episode frame"
                  disabled={frameIndex >= activeReview.frames.length - 1}
                  onClick={() => {
                    setPlaying(false);
                    setReviewing(true);
                    setFrameIndex(Math.min(activeReview.frames.length - 1, frameIndex + 1));
                  }}
                  size="icon"
                  title="Next episode frame"
                  variant="ghost"
                >
                  <StepForward />
                </Button>
              </div>

              {(readOnly ||
                !currentFrame.qpos ||
                !currentFrame.qvel ||
                !currentFrame.ctrl ||
                currentFrame.phase) && (
                <div className="grid gap-2 border-t border-border pt-3">
                  {readOnly && (
                    <p className="text-[10px] text-muted">
                      Recorded in an earlier scene version, so the viewport keeps showing the
                      current scene.
                    </p>
                  )}
                  {!readOnly &&
                    (!currentFrame.qpos || !currentFrame.qvel || !currentFrame.ctrl) && (
                      <p className="text-[10px] text-warning">
                        This older episode has no full-state snapshot for 3D replay.
                      </p>
                    )}
                  {currentFrame.phase && (
                    <p className="text-[10px] text-muted">Phase: {currentFrame.phase}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {error && <p className="text-[10px] leading-relaxed text-danger">{error}</p>}

      {!loading &&
        showCameraPreview &&
        activeReview &&
        currentFrame &&
        reviewEpisode &&
        cameraPreviewHost &&
        createPortal(
          <EpisodeCameraPreviewStrip
            cameras={activeReview.cameras}
            episodeId={reviewEpisode.episodeId}
            framePosition={frameIndex}
            sourcePath={source.path}
          />,
          cameraPreviewHost,
        )}
      {!loading &&
        showStatsGraphs &&
        activeReview &&
        currentFrame &&
        statsGraphsHost &&
        createPortal(
          <EpisodeStateActionGraphs
            actionLabels={actionFieldNames}
            currentFrameIndex={frameIndex}
            frames={activeReview.frames}
            stateLabels={stateFieldNames}
          />,
          statsGraphsHost,
        )}

      <div className="space-y-2 border-t border-border pt-3">
        <Button
          aria-label={
            rawDataset.downloading
              ? 'Cancel raw dataset download'
              : 'Download raw dataset and training bundle'
          }
          className="w-full gap-2"
          disabled={!rawDataset.downloading && !canDownloadRawDataset}
          onClick={() => {
            if (rawDataset.downloading) {
              rawDataset.cancel();
              return;
            }
            setError(null);
            setRawDatasetNote(null);
            rawDataset.download();
          }}
          size="md"
          title={
            rawDataset.downloading
              ? 'Cancel raw dataset download'
              : 'Download raw dataset and training bundle'
          }
          variant="primary"
        >
          {rawDataset.downloading ? <X /> : <Download />}
          {downloadButtonLabel}
        </Button>
        {rawDatasetNote && rawDataset.status === 'idle' && (
          <p className="text-[10px] leading-relaxed text-muted" role="status">
            {rawDatasetNote}
          </p>
        )}
        {rawDataset.status !== 'idle' && (
          <div
            aria-live="polite"
            className="space-y-2 border border-border bg-background p-2.5"
            role="status"
          >
            <div className="flex items-center justify-between gap-2 text-[10px] text-muted">
              <span>
                {rawDataset.status === 'preparing'
                  ? rawDataset.phase === 'generating-training-environment'
                    ? 'Generating training environment...'
                    : rawDataset.phase === 'archiving'
                      ? 'Building raw dataset archive...'
                      : 'Preparing raw dataset and training bundle...'
                  : rawDataset.status === 'downloading'
                    ? 'Downloading raw dataset and training bundle...'
                    : 'Raw dataset and training bundle downloaded.'}
              </span>
              <span className="shrink-0 tabular-nums">
                {rawDataset.total
                  ? `${Math.min(Math.round((rawDataset.bytes / rawDataset.total) * 100), 100)}%`
                  : formatBytes(rawDataset.bytes)}
              </span>
            </div>
            <progress
              aria-label="Raw dataset download progress"
              className="h-1.5 w-full accent-accent"
              max={rawDataset.total ?? undefined}
              value={rawDataset.total ? rawDataset.bytes : undefined}
            />
            <p className="text-[9px] text-muted">
              {rawDataset.total
                ? `${formatBytes(rawDataset.bytes)} of ${formatBytes(rawDataset.total)}`
                : `${formatBytes(rawDataset.bytes)} downloaded`}
            </p>
          </div>
        )}
      </div>

      <Dialog
        open={editing}
        title="Edit episode"
        description="Update the label or notes for this saved episode."
        onClose={() => {
          if (!saving) setEditing(false);
        }}
      >
        <div className="space-y-4">
          <label className="block text-[10px] text-muted">
            Name
            <input
              aria-label="Episode name"
              className="mt-1 h-8 w-full border border-border bg-background px-2 text-xs text-foreground"
              maxLength={200}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
            />
          </label>
          <label className="block text-[10px] text-muted">
            Notes
            <textarea
              aria-label="Episode notes"
              className="mt-1 min-h-24 w-full resize-y border border-border bg-background px-2 py-1.5 text-xs text-foreground"
              maxLength={4_000}
              value={draftNotes}
              onChange={(event) => setDraftNotes(event.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button disabled={saving} onClick={() => setEditing(false)} variant="ghost">
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => void saveMetadata()} variant="primary">
              {saving && <LoaderCircle className="animate-spin" />}
              Save changes
            </Button>
          </div>
        </div>
      </Dialog>
      <DeleteDialog
        open={deleteDialogOpen}
        itemName={selectedEpisode ? episodeLabel(selectedEpisode) : 'episode'}
        itemType="episode"
        busy={deleting}
        onCancel={() => {
          if (!deleting) setDeleteDialogOpen(false);
        }}
        onConfirm={() => void removeEpisode()}
      />
    </div>
  );
}
