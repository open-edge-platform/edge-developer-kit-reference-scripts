// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { RuntimeFile } from '@mujoco-studio/mujoco';
import { DEFAULT_SCENE } from '@mujoco-studio/scene';
import { create } from 'zustand';

import {
  DEFAULT_SPLAT_CALIBRATION,
  type SplatCalibration,
  type Vec3Tuple,
} from '../editor/splatCollision';
import type { TransformFeedback } from '../editor/transformInteraction';

export type ViewportHelpers = {
  grid: boolean;
  axes: boolean;
  shadows: boolean;
};

export type TransformMode = 'translate' | 'rotate' | 'scale';
export type TransformSpace = 'world' | 'local';
export type TransformAxis = 'x' | 'y' | 'z';
export type EditTool = 'transform' | 'place-on-object';

/** The splat backdrop PLY of the open scene, kept apart from MuJoCo-staged runtime files. */
export interface SplatFileState {
  file: Blob;
  filename: string;
  /** Worker runtime file (`kind: 'splat'`); `checksum` is the SHA-256 hex of the bytes. */
  runtime: RuntimeFile;
}

/** A splat PLY stored as a scene asset. */
export interface SplatAssetRef {
  assetId: number;
  hash: string;
  /** Worker runtime path, `splats/<assetId>/<filename>`. */
  path: string;
  calibration: SplatCalibration;
  origin: Vec3Tuple;
  /**
   * The saved file failed to download this session: the record is kept so saving does not drop
   * the backdrop, but a re-upload of the same PLY must not reuse it (it uploads a fresh asset).
   */
  unreadable?: boolean;
}

interface SplatBackdropState {
  calibration: SplatCalibration;
  origin: Vec3Tuple;
}

const backdropOf = (state: EditorState): SplatBackdropState | null =>
  state.splatOrigin
    ? {
        calibration: state.splatCalibration,
        origin: state.splatOrigin,
      }
    : null;

export interface HistoryEntry {
  xml: string;
  backdrop: SplatBackdropState | null;
}

interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

/** Caps undo/redo stacks so long editing sessions don't accumulate unbounded full-document XML snapshots. */
const MAX_HISTORY_ENTRIES = 100;

interface ReplaceXmlOptions {
  markSaved?: boolean;
}

interface EditorState {
  selectedIds: string[];
  selectionAnchor: string | null;
  hoveredId: string | null;
  expanded: Record<string, boolean>;
  helpers: ViewportHelpers;
  xml: string;
  savedXml: string;
  history: HistoryState;
  editingId: string | null;
  /** Optional axis lock for direct drags and the gizmo; null means every handle is offered. */
  transformAxis: TransformAxis | null;
  transformMode: TransformMode;
  transformSpace: TransformSpace;
  editTool: EditTool;
  editToolStatus: string | null;
  snap: boolean;
  /** Live state of the transform drag in progress, for guides and the readout. */
  transformFeedback: TransformFeedback | null;
  splatSrc: string | null;
  splatStatus: 'idle' | 'loading' | 'ready' | 'error';
  splatError: string | null;
  /**
   * Alignment origin of the applied calibration (`[-cx, -cy, -floor + level]`). The backdrop
   * body pose in the MJCF is the pose source of truth; this is only the reference that
   * recalibration offsets the body by, so the user's placement survives a recalibration.
   */
  splatOrigin: Vec3Tuple | null;
  splatCalibration: SplatCalibration;
  /**
   * Whether splat tables are drawn (and pickable) in the viewport: only while the Build > Splat tab
   * is open. They always collide and are always hidden from cameras.
   */
  splatTablesVisible: boolean;
  /** Runtime scene key the current splat belongs to, so switching scenes can clear it. */
  splatSceneKey: string | null;
  splatFile: SplatFileState | null;
  /**
   * The backdrop asset saved with the scene; a save skips re-uploading a PLY with this hash.
   * Survives the editor remount after a new scene's first save.
   */
  splatAsset: SplatAssetRef | null;
  select: (id: string | null, options?: { additive?: boolean; range?: string[] }) => void;
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;
  hover: (id: string | null) => void;
  toggleExpanded: (id: string) => void;
  setExpanded: (ids: string[], value: boolean) => void;
  toggleHelper: (key: keyof ViewportHelpers) => void;
  beginEdit: (id?: string) => void;
  endEdit: () => void;
  setTransformAxis: (axis: TransformAxis | null) => void;
  /** Locks to `axis`, or unlocks when it is already the locked axis. */
  toggleTransformAxis: (axis: TransformAxis) => void;
  setTransformMode: (mode: TransformMode) => void;
  setTransformSpace: (space: TransformSpace) => void;
  setEditTool: (tool: EditTool) => void;
  setEditToolStatus: (status: string | null) => void;
  toggleSnap: () => void;
  setTransformFeedback: (feedback: TransformFeedback | null) => void;
  /** Starts loading a splat; calibration and backdrop data are replaced atomically. */
  setSplatSrc: (
    src: string | null,
    options?: { calibration?: SplatCalibration; sceneKey?: string | null },
  ) => void;
  setSplatStatus: (status: EditorState['splatStatus'], error?: string | null) => void;
  /** Records an applied (compiled) backdrop calibration. */
  setSplatBackdrop: (backdrop: SplatBackdropState | null) => void;
  setSplatSceneKey: (key: string | null) => void;
  setSplatFile: (file: SplatFileState | null) => void;
  setSplatAsset: (asset: SplatAssetRef | null) => void;
  setSplatTablesVisible: (visible: boolean) => void;
  clearSplat: () => void;
  replaceXml: (xml: string, options?: ReplaceXmlOptions) => void;
  markSaved: (xml?: string) => void;
  markUnsaved: () => void;
  commitXml: (xml: string) => void;
  undo: () => HistoryEntry | null;
  redo: () => HistoryEntry | null;
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedIds: [],
  selectionAnchor: null,
  hoveredId: null,
  expanded: {},
  helpers: { grid: true, axes: true, shadows: true },
  xml: DEFAULT_SCENE.xml,
  savedXml: DEFAULT_SCENE.xml,
  history: { past: [], future: [] },
  editingId: null,
  transformAxis: null,
  transformMode: 'translate',
  transformSpace: 'world',
  editTool: 'transform',
  editToolStatus: null,
  snap: false,
  transformFeedback: null,
  splatSrc: null,
  splatOrigin: null,
  splatStatus: 'idle',
  splatError: null,
  splatCalibration: DEFAULT_SPLAT_CALIBRATION,
  splatTablesVisible: false,
  splatSceneKey: null,
  splatFile: null,
  splatAsset: null,
  select: (id, options) =>
    set((state) => {
      if (!id)
        return {
          selectedIds: [],
          selectionAnchor: null,
          editingId: null,
          editTool: 'transform',
          editToolStatus: null,
        };
      if (options?.range) {
        const anchor = state.selectionAnchor ?? id;
        const start = options.range.indexOf(anchor);
        const end = options.range.indexOf(id);
        if (start >= 0 && end >= 0) {
          return {
            selectedIds: options.range.slice(Math.min(start, end), Math.max(start, end) + 1),
            selectionAnchor: anchor,
            editingId: null,
            editTool: 'transform',
            editToolStatus: null,
          };
        }
      }
      if (options?.additive) {
        const selectedIds = state.selectedIds.includes(id)
          ? state.selectedIds.filter((selectedId) => selectedId !== id)
          : [...state.selectedIds, id];
        return {
          selectedIds,
          selectionAnchor: selectedIds.length ? id : null,
          editingId: null,
          editTool: 'transform',
          editToolStatus: null,
        };
      }
      return {
        selectedIds: [id],
        selectionAnchor: id,
        editingId: state.editingId === id ? id : null,
        editTool: state.editingId === id ? state.editTool : 'transform',
        editToolStatus: state.editingId === id ? state.editToolStatus : null,
      };
    }),
  setSelection: (selectedIds) =>
    set({
      selectedIds,
      selectionAnchor: selectedIds.length ? selectedIds[0] : null,
      editingId: null,
      editTool: 'transform',
      editToolStatus: null,
    }),
  clearSelection: () =>
    set({
      selectedIds: [],
      selectionAnchor: null,
      editingId: null,
      editTool: 'transform',
      editToolStatus: null,
    }),
  hover: (id) => set({ hoveredId: id }),
  toggleExpanded: (id) =>
    set((state) => ({ expanded: { ...state.expanded, [id]: !state.expanded[id] } })),
  setExpanded: (ids, value) =>
    set((state) => ({
      expanded: { ...state.expanded, ...Object.fromEntries(ids.map((id) => [id, value])) },
    })),
  toggleHelper: (key) =>
    set((state) => ({ helpers: { ...state.helpers, [key]: !state.helpers[key] } })),
  beginEdit: (id) =>
    set((state) => {
      const editingId = id ?? (state.selectedIds.length === 1 ? state.selectedIds[0] : null);
      return editingId
        ? {
            editingId,
            selectedIds: [editingId],
            selectionAnchor: editingId,
            editTool: 'transform',
            editToolStatus: null,
          }
        : state;
    }),
  endEdit: () => set({ editingId: null, editTool: 'transform', editToolStatus: null }),
  setTransformAxis: (transformAxis) => set({ transformAxis }),
  toggleTransformAxis: (axis) =>
    set((state) => ({ transformAxis: state.transformAxis === axis ? null : axis })),
  setTransformMode: (transformMode) => set({ transformMode, editTool: 'transform' }),
  setTransformSpace: (transformSpace) => set({ transformSpace }),
  setEditTool: (editTool) => set({ editTool, editToolStatus: null }),
  setEditToolStatus: (editToolStatus) => set({ editToolStatus }),
  toggleSnap: () => set((state) => ({ snap: !state.snap })),
  setTransformFeedback: (transformFeedback) => set({ transformFeedback }),
  setSplatSrc: (splatSrc, options) =>
    set({
      splatSrc,
      splatStatus: splatSrc ? 'loading' : 'idle',
      splatError: null,
      splatOrigin: null,
      splatCalibration: options?.calibration ?? DEFAULT_SPLAT_CALIBRATION,
      splatSceneKey: options?.sceneKey ?? null,
    }),
  setSplatStatus: (splatStatus, error = null) => set({ splatStatus, splatError: error }),
  setSplatBackdrop: (backdrop) =>
    set({
      splatCalibration: backdrop?.calibration ?? DEFAULT_SPLAT_CALIBRATION,
      splatOrigin: backdrop?.origin ?? null,
    }),
  setSplatSceneKey: (splatSceneKey) => set({ splatSceneKey }),
  setSplatFile: (splatFile) => set({ splatFile }),
  setSplatAsset: (splatAsset) => set({ splatAsset }),
  setSplatTablesVisible: (splatTablesVisible) => set({ splatTablesVisible }),
  clearSplat: () =>
    set({
      splatSrc: null,
      splatStatus: 'idle',
      splatError: null,
      splatOrigin: null,
      splatCalibration: DEFAULT_SPLAT_CALIBRATION,
      splatSceneKey: null,
      splatFile: null,
    }),
  replaceXml: (xml, options) =>
    set((state) => ({
      xml,
      savedXml: options?.markSaved ? xml : state.savedXml,
      history: { past: [], future: [] },
      selectedIds: [],
      editingId: null,
      editTool: 'transform',
      editToolStatus: null,
    })),
  markSaved: (xml) => set((state) => ({ savedXml: xml ?? state.xml })),
  markUnsaved: () => set({ savedXml: '' }),
  commitXml: (xml) =>
    set((state) => {
      if (state.xml === xml) return state;
      const past = [...state.history.past, { xml: state.xml, backdrop: backdropOf(state) }].slice(
        -MAX_HISTORY_ENTRIES,
      );
      return { xml, history: { past, future: [] } };
    }),
  undo: () => {
    let previous: HistoryEntry | null = null;
    set((state) => {
      previous = state.history.past.at(-1) ?? null;
      if (!previous) return state;
      return {
        xml: previous.xml,
        splatCalibration: previous.backdrop?.calibration ?? DEFAULT_SPLAT_CALIBRATION,
        splatOrigin: previous.backdrop?.origin ?? null,
        history: {
          past: state.history.past.slice(0, -1),
          future: [
            {
              xml: state.xml,
              backdrop: backdropOf(state),
            },
            ...state.history.future,
          ].slice(0, MAX_HISTORY_ENTRIES),
        },
        selectedIds: [],
        editingId: null,
        editTool: 'transform',
        editToolStatus: null,
      };
    });
    return previous;
  },
  redo: () => {
    let next: HistoryEntry | null = null;
    set((state) => {
      next = state.history.future[0] ?? null;
      if (!next) return state;
      return {
        xml: next.xml,
        splatCalibration: next.backdrop?.calibration ?? DEFAULT_SPLAT_CALIBRATION,
        splatOrigin: next.backdrop?.origin ?? null,
        history: {
          past: [
            ...state.history.past,
            {
              xml: state.xml,
              backdrop: backdropOf(state),
            },
          ].slice(-MAX_HISTORY_ENTRIES),
          future: state.history.future.slice(1),
        },
        selectedIds: [],
        editingId: null,
        editTool: 'transform',
        editToolStatus: null,
      };
    });
    return next;
  },
}));
