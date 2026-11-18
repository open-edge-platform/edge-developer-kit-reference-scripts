// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import type {
  ModelInfo,
  SceneGraph,
  SimulationStats,
  SimulationStatus,
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

import { loadMujoco, type Mujoco, type RuntimeOptions } from './runtime';
import {
  clearStagedRuntimeFiles,
  retainRuntimeFiles,
  stageRuntimeFiles,
  type RuntimeFile,
} from './runtimeFiles';
import { buildSceneGraph } from './sceneLoader';
import { Simulation, type RemoteSimulationSnapshot } from './simulation';
import { SimulationLoop } from './simulationLoop';

const EMPTY_STATS: SimulationStats = { time: 0, fps: 0, stepsPerSecond: 0, physicsMs: 0 };

export interface PhysicsContextValue {
  status: SimulationStatus;
  error: string | null;
  graph: SceneGraph | null;
  info: ModelInfo | null;
  stats: SimulationStats;
  isRunning: boolean;
  loadedSceneKey: string | null;
  simulationRevision: number;
  loadedSceneXml: string | null;
  speed: number;
  loop: SimulationLoop;
  /** Current simulation, or null before the first successful `loadScene`. */
  getSimulation: () => Simulation | null;
  /** Writes asset artifacts into MuJoCo's virtual filesystem before compilation. */
  stageFiles: (files: readonly RuntimeFile[]) => void;
  retainFiles: (paths: ReadonlySet<string>) => void;
  /** Compiles MJCF and swaps it in. Returns null and sets `error` on failure. */
  loadScene: (xml: string, name?: string, sceneKey?: string) => Simulation | null;
  /**
   * The compiler message from the most recent `loadScene` call, or null if it succeeded. Unlike
   * `error`, this is readable synchronously right after a failed `loadScene`.
   */
  getLastLoadError: () => string | null;
  play: () => void;
  pause: () => void;
  step: (count?: number) => void;
  reset: () => void;
  setJointPosition: (jointIndex: number, value: number) => void;
  setJointPositions: (positions: readonly { jointIndex: number; value: number }[]) => void;
  setActuatorControl: (actuatorIndex: number, value: number) => void;
  captureResetPose: () => void;
  clearResetPose: () => void;
  getResetPoseJointPositions: () => Record<string, number> | null;
  setResetPose: (positions: Readonly<Record<string, number>>) => void;
  setSpeed: (speed: number) => void;
  acquireExternalControl: () => string;
  releaseExternalControl: (lease: string) => void;
  /** Whether `lease` still controls the simulation; Build edits reload it and drop leases. */
  holdsExternalControl: (lease: string) => boolean;
  applyRemoteSnapshot: (lease: string, snapshot: RemoteSimulationSnapshot) => void;
}

const PhysicsContext = createContext<PhysicsContextValue | null>(null);

export interface PhysicsProviderProps extends RuntimeOptions {
  children: ReactNode;
  /** MJCF compiled as soon as the WASM runtime is ready. */
  initialScene?: string;
  initialSceneName?: string;
  /** Runtime asset files staged before the initial MJCF compilation. */
  initialFiles?: readonly RuntimeFile[];
}

export function PhysicsProvider({
  children,
  initialScene,
  initialSceneName = 'scene',
  initialFiles,
  runtimeUrl,
  wasmUrl,
}: PhysicsProviderProps) {
  const mujocoRef = useRef<Mujoco | null>(null);
  const simulationRef = useRef<Simulation | null>(null);
  const loadedSceneKeyRef = useRef<string | null>(null);
  const lastLoadErrorRef = useRef<string | null>(null);
  const getLastLoadError = useCallback(() => lastLoadErrorRef.current, []);
  const loop = useMemo(() => new SimulationLoop(), []);
  const getSimulation = useCallback(() => simulationRef.current, []);
  const retainFiles = useCallback((paths: ReadonlySet<string>) => {
    const mujoco = mujocoRef.current;
    if (!mujoco) throw new Error('MuJoCo runtime is not ready yet');
    retainRuntimeFiles(mujoco, paths);
  }, []);

  const [status, setStatus] = useState<SimulationStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<SceneGraph | null>(null);
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [stats, setStats] = useState<SimulationStats>(EMPTY_STATS);
  const [isRunning, setIsRunning] = useState(false);
  const [loadedSceneKey, setLoadedSceneKey] = useState<string | null>(null);
  const [simulationRevision, setSimulationRevision] = useState(0);
  const [loadedSceneXml, setLoadedSceneXml] = useState<string | null>(null);
  const [speed, setSpeedState] = useState(1);
  const acquireExternalControl = useCallback(() => loop.acquireExternalControl(), [loop]);
  const releaseExternalControl = useCallback(
    (lease: string) => loop.releaseExternalControl(lease),
    [loop],
  );
  const holdsExternalControl = useCallback(
    (lease: string) => loop.holdsExternalControl(lease),
    [loop],
  );
  const applyRemoteSnapshot = useCallback(
    (lease: string, snapshot: RemoteSimulationSnapshot) => loop.externalSnapshot(lease, snapshot),
    [loop],
  );

  const loadScene = useCallback(
    (xml: string, name = 'scene', sceneKey?: string): Simulation | null => {
      const mujoco = mujocoRef.current;
      if (!mujoco) {
        lastLoadErrorRef.current = 'MuJoCo runtime is not ready yet';
        setError(lastLoadErrorRef.current);
        return null;
      }

      if (
        simulationRef.current &&
        sceneKey !== undefined &&
        loadedSceneKeyRef.current === sceneKey
      ) {
        return simulationRef.current;
      }

      const inheritedResetPose =
        sceneKey === undefined ? simulationRef.current?.getResetPoseJointPositions() : null;
      const previousScene = simulationRef.current?.memoryInfo();
      const started = performance.now();
      let next: Simulation;
      try {
        next = new Simulation(mujoco, xml, name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('MuJoCo compilation failed', {
          message,
          compileMs: performance.now() - started,
          previousScene,
        });
        const exhausted = /memory|alloc|heap|out of bounds/i.test(message);
        lastLoadErrorRef.current =
          message +
          (exhausted
            ? ' The browser MuJoCo heap is limited to 2 GiB and compilation temporarily holds both scenes. Simplify meshes and textures or remove objects, then reload the saved scene if the runtime is no longer usable.'
            : '');
        setError(lastLoadErrorRef.current);
        return null;
      }

      console.info('MuJoCo compilation completed', {
        compileMs: performance.now() - started,
        previousScene,
        ...next.memoryInfo(),
      });
      lastLoadErrorRef.current = null;
      simulationRef.current?.dispose();
      simulationRef.current = next;
      loop.setSimulation(next);
      if (inheritedResetPose) {
        try {
          next.setResetPose(inheritedResetPose);
        } catch {
          // A document edit may have removed or changed a saved joint.
        }
      }

      setGraph(buildSceneGraph(next));
      setInfo(next.info());
      setIsRunning(false);
      setError(null);
      setStatus('ready');
      setSimulationRevision((revision) => revision + 1);
      loadedSceneKeyRef.current = sceneKey ?? loadedSceneKeyRef.current;
      setLoadedSceneKey(loadedSceneKeyRef.current);
      setLoadedSceneXml(xml);
      return next;
    },
    [loop],
  );

  useEffect(() => loop.subscribe(setStats), [loop]);

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      try {
        const mujoco = await loadMujoco({ runtimeUrl, wasmUrl });
        if (cancelled) return;
        mujocoRef.current = mujoco;
        setStatus('ready');
        if (initialFiles?.length) stageRuntimeFiles(mujoco, initialFiles);
        if (initialScene) loadScene(initialScene, initialSceneName);
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    boot();

    return () => {
      cancelled = true;
      loop.setSimulation(null);
      simulationRef.current?.dispose();
      simulationRef.current = null;
      loadedSceneKeyRef.current = null;
      setLoadedSceneKey(null);
      setLoadedSceneXml(null);
      if (mujocoRef.current) clearStagedRuntimeFiles(mujocoRef.current);
    };
  }, [initialFiles, initialScene, initialSceneName, loadScene, loop, runtimeUrl, wasmUrl]);

  const value = useMemo<PhysicsContextValue>(
    () => ({
      status,
      error,
      graph,
      info,
      stats,
      isRunning,
      loadedSceneKey,
      simulationRevision,
      loadedSceneXml,
      speed,
      loop,
      getSimulation,
      stageFiles: (files) => {
        const mujoco = mujocoRef.current;
        if (!mujoco) throw new Error('MuJoCo runtime is not ready yet');
        stageRuntimeFiles(mujoco, files);
      },
      retainFiles,
      loadScene,
      getLastLoadError,
      play: () => {
        loop.play();
        setIsRunning(loop.isRunning);
      },
      pause: () => {
        loop.pause();
        setIsRunning(false);
      },
      step: (count = 1) => loop.step(count),
      reset: () => loop.reset(),
      setJointPosition: (jointIndex, value) => loop.setJointPosition(jointIndex, value),
      setJointPositions: (positions) => loop.setJointPositions(positions),
      setActuatorControl: (actuatorIndex, value) => loop.setActuatorControl(actuatorIndex, value),
      captureResetPose: () => loop.captureResetPose(),
      clearResetPose: () => loop.clearResetPose(),
      getResetPoseJointPositions: () => loop.getResetPoseJointPositions(),
      setResetPose: (positions) => loop.setResetPose(positions),
      setSpeed: (next: number) => {
        loop.setSpeed(next);
        setSpeedState(loop.playbackSpeed);
      },
      acquireExternalControl,
      releaseExternalControl,
      holdsExternalControl,
      applyRemoteSnapshot,
    }),
    [
      error,
      acquireExternalControl,
      holdsExternalControl,
      applyRemoteSnapshot,
      getSimulation,
      getLastLoadError,
      retainFiles,
      graph,
      info,
      isRunning,
      loadScene,
      loop,
      releaseExternalControl,
      speed,
      stats,
      status,
      simulationRevision,
    ],
  );

  return <PhysicsContext.Provider value={value}>{children}</PhysicsContext.Provider>;
}

export function usePhysics(): PhysicsContextValue {
  const context = useContext(PhysicsContext);
  if (!context) throw new Error('usePhysics must be used inside a <PhysicsProvider>');
  return context;
}
