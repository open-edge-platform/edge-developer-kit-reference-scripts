// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import type {
  TeleoperationEpisodeFrameV1,
  TeleoperationEpisodeCameraV1,
} from '@mujoco-studio/types';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ReviewVideo } from './ReviewFrameViews';

interface FloatingPanelRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Keeps at least a corner of the panel reachable after the window is resized. */
function clampRect(rect: FloatingPanelRect): FloatingPanelRect {
  const margin = 32;
  return {
    ...rect,
    left: Math.min(Math.max(rect.left, margin - rect.width), window.innerWidth - margin),
    top: Math.min(Math.max(rect.top, 0), window.innerHeight - margin),
  };
}

/**
 * A floating window that can be dragged by its header and resized from its bottom-right corner.
 * Positioned `fixed`, so it floats over the whole viewport regardless of its portal host.
 */
function FloatingPanel({
  title,
  defaultRect,
  minWidth = 220,
  minHeight = 140,
  resizable = true,
  children,
}: {
  title: string;
  defaultRect: () => FloatingPanelRect;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
  children: ReactNode;
}) {
  const [rect, setRect] = useState(defaultRect);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: FloatingPanelRect;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: FloatingPanelRect;
  } | null>(null);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (drag && event.pointerId === drag.pointerId) {
        setRect(
          clampRect({
            ...drag.origin,
            left: drag.origin.left + (event.clientX - drag.startX),
            top: drag.origin.top + (event.clientY - drag.startY),
          }),
        );
        return;
      }
      const resize = resizeRef.current;
      if (resize && event.pointerId === resize.pointerId) {
        setRect({
          ...resize.origin,
          width: Math.max(minWidth, resize.origin.width + (event.clientX - resize.startX)),
          height: Math.max(minHeight, resize.origin.height + (event.clientY - resize.startY)),
        });
      }
    }
    function onPointerUp(event: PointerEvent) {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
      if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null;
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [minHeight, minWidth]);

  return (
    <section
      aria-label={title}
      className="pointer-events-auto fixed z-20 flex flex-col border border-border bg-surface shadow-2xl"
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
    >
      <div
        className="flex shrink-0 cursor-grab touch-none items-center gap-2 border-b border-border px-2 py-1 active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            origin: rect,
          };
        }}
      >
        <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted">
          {title}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
      {resizable && (
        <div
          aria-hidden="true"
          className="absolute bottom-0 right-0 size-4 touch-none cursor-nwse-resize"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              origin: rect,
            };
          }}
        >
          <svg className="absolute bottom-0.5 right-0.5 size-2.5 text-muted" viewBox="0 0 10 10">
            <path d="M9 1L1 9M9 4L4 9M9 7L7 9" stroke="currentColor" strokeWidth={1.2} />
          </svg>
        </div>
      )}
    </section>
  );
}

/** One dimension's values across every frame of the episode, for one mini chart. */
function seriesByDimension(
  frames: readonly TeleoperationEpisodeFrameV1[],
  pick: (frame: TeleoperationEpisodeFrameV1) => number[],
): number[][] {
  const dimensions = frames[0] ? pick(frames[0]).length : 0;
  return Array.from({ length: dimensions }, (_, index) =>
    frames.map((frame) => pick(frame)[index] ?? 0),
  );
}

function labelFor(labels: readonly string[], index: number, fallback: string): string {
  return labels[index]?.trim() || `${fallback} ${index + 1}`;
}

const CHART_VIEW_WIDTH = 140;
const CHART_HEIGHT = 48;
const CHART_COLUMNS = 2;
const CHART_GAP = 6; // gap-1.5
const CHART_DEFAULT_COLUMN_WIDTH = CHART_VIEW_WIDTH + 16; // only sizes the initial rect
const CHART_ROW_HEIGHT = CHART_HEIGHT + 36; // label row + padding + border
function graphColumns(stateCount: number, actionCount: number): number {
  return Math.min(CHART_COLUMNS, Math.max(stateCount, actionCount, 1));
}

/** Default size that fits every state/action chart without needing a manual resize. */
function graphsDefaultRect(stateCount: number, actionCount: number): FloatingPanelRect {
  const columns = graphColumns(stateCount, actionCount);
  const sectionHeight = (count: number): number => {
    if (count === 0) return 0;
    const rows = Math.ceil(count / columns);
    return 16 /* heading row */ + rows * CHART_ROW_HEIGHT + (rows - 1) * CHART_GAP;
  };
  const width = columns * CHART_DEFAULT_COLUMN_WIDTH + (columns - 1) * CHART_GAP + 16; // body padding
  const sectionsGap = stateCount > 0 && actionCount > 0 ? 12 : 0;
  const height =
    28 /* header */ +
    16 /* body padding */ +
    sectionHeight(stateCount) +
    sectionsGap +
    sectionHeight(actionCount);
  return {
    top: 64,
    left: 16,
    width: Math.min(Math.max(width, 260), window.innerWidth - 32),
    height: Math.min(Math.max(height, 200), window.innerHeight - 96),
  };
}

/** A small line chart of one state or action dimension across an episode's frames. */
function MiniLineChart({
  label,
  values,
  currentIndex,
}: {
  label: string;
  values: number[];
  currentIndex: number;
}) {
  const width = CHART_VIEW_WIDTH;
  const height = CHART_HEIGHT;
  const padding = 4;
  // Episodes can have thousands of frames; reduce instead of spreading into Math.min/max.
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min || 1;
  const points = values.map((value, index): readonly [number, number] => [
    values.length > 1 ? (index / (values.length - 1)) * (width - padding * 2) + padding : width / 2,
    height - padding - ((value - min) / range) * (height - padding * 2),
  ]);
  const path = points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const markerIndex = Math.min(Math.max(currentIndex, 0), points.length - 1);
  const marker = points[markerIndex];
  const currentValue = values[markerIndex];

  return (
    <div className="min-w-0 border border-border bg-background p-1.5">
      <div className="flex items-center justify-between gap-1 text-[9px] text-muted">
        <span className="truncate" title={label}>
          {label}
        </span>
        <span className="shrink-0 tabular-nums text-foreground">{currentValue?.toFixed(3)}</span>
      </div>
      <svg
        aria-label={`${label} over steps`}
        className="mt-1 w-full"
        height={height}
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <line
          className="stroke-border"
          strokeWidth={1}
          x1={padding}
          x2={width - padding}
          y1={height - padding}
          y2={height - padding}
        />
        <text className="fill-muted" fontSize={6} x={padding} y={padding + 5}>
          {max.toFixed(2)}
        </text>
        <text className="fill-muted" fontSize={6} x={padding} y={height - padding - 1}>
          {min.toFixed(2)}
        </text>
        <path className="stroke-accent" d={path} fill="none" strokeWidth={1.5} />
        {marker && <circle className="fill-accent" cx={marker[0]} cy={marker[1]} r={2.5} />}
      </svg>
    </div>
  );
}

/**
 * Viewport overlay (default top-left) plotting each state and action dimension of the reviewed
 * episode against the frame/step index, with a marker at the frame currently shown. Draggable by
 * its header and resizable from its bottom-right corner.
 */
export function EpisodeStateActionGraphs({
  frames,
  currentFrameIndex,
  stateLabels,
  actionLabels,
}: {
  frames: readonly TeleoperationEpisodeFrameV1[];
  currentFrameIndex: number;
  stateLabels: readonly string[];
  actionLabels: readonly string[];
}) {
  const stateSeries = useMemo(() => seriesByDimension(frames, (frame) => frame.state), [frames]);
  const actionSeries = useMemo(() => seriesByDimension(frames, (frame) => frame.action), [frames]);
  const columns = graphColumns(stateSeries.length, actionSeries.length);
  const gridStyle = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

  if (frames.length === 0 || (stateSeries.length === 0 && actionSeries.length === 0)) return null;

  return (
    <FloatingPanel
      defaultRect={() => graphsDefaultRect(stateSeries.length, actionSeries.length)}
      minHeight={200}
      minWidth={260}
      resizable={false}
      title="Episode state and action graphs"
    >
      <div className="flex flex-col gap-3">
        {stateSeries.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted">State</h3>
            <div className="grid gap-1.5" style={gridStyle}>
              {stateSeries.map((series, index) => (
                <MiniLineChart
                  key={index}
                  currentIndex={currentFrameIndex}
                  label={labelFor(stateLabels, index, 'State')}
                  values={series}
                />
              ))}
            </div>
          </div>
        )}
        {actionSeries.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted">
              Action
            </h3>
            <div className="grid gap-1.5" style={gridStyle}>
              {actionSeries.map((series, index) => (
                <MiniLineChart
                  key={index}
                  currentIndex={currentFrameIndex}
                  label={labelFor(actionLabels, index, 'Action')}
                  values={series}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}

// A comfortable width per camera, so 1, 2, or 3 cameras each show their full frame by default.
const CAMERA_SLOT_WIDTH = 320;
const CAMERA_PANEL_GAP = 8; // gap-2

/** Default size that fits every camera's full frame side by side without needing a manual resize. */
function camerasDefaultRect(cameraCount: number): FloatingPanelRect {
  const slots = Math.max(cameraCount, 1);
  const contentWidth = slots * CAMERA_SLOT_WIDTH + (slots - 1) * CAMERA_PANEL_GAP;
  const width = Math.min(window.innerWidth - 32, contentWidth + 16 /* body padding */);
  const height = Math.min(360, window.innerHeight - 96);
  return { top: Math.max(64, window.innerHeight - height - 20), left: 16, width, height };
}

/**
 * Viewport overlay (default bottom-left) showing the reviewed episode's camera frames. Draggable
 * by its header and resizable from its bottom-right corner.
 */
export function EpisodeCameraPreviewStrip({
  cameras,
  sourcePath,
  episodeId,
  framePosition,
}: {
  cameras: readonly TeleoperationEpisodeCameraV1[];
  sourcePath: string;
  episodeId: string;
  framePosition: number;
}) {
  if (cameras.length === 0) return null;

  return (
    <FloatingPanel
      defaultRect={() => camerasDefaultRect(cameras.length)}
      minHeight={180}
      minWidth={260}
      title="Episode cameras"
    >
      <div className="flex h-full gap-2 overflow-x-auto">
        {cameras.map((camera) => (
          <div key={camera.name} className="h-full min-w-56 flex-1 basis-80">
            <ReviewVideo
              camera={camera}
              episodeId={episodeId}
              framePosition={framePosition}
              sourcePath={sourcePath}
            />
          </div>
        ))}
      </div>
    </FloatingPanel>
  );
}
