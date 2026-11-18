// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type SimulationStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SimulationStats {
  /** Simulated seconds elapsed since the last reset. */
  time: number;
  /** Rendered frames per second, averaged over a short window. */
  fps: number;
  /** Physics steps executed in the last second. */
  stepsPerSecond: number;
  /** Wall-clock milliseconds spent inside `mj_step` per frame. */
  physicsMs: number;
}

export interface ModelInfo {
  name: string;
  nbody: number;
  ngeom: number;
  njnt: number;
  nq: number;
  nu: number;
  timestep: number;
}
