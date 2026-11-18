// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { SimulationStats } from '@mujoco-studio/types';

import type { RemoteSimulationSnapshot, Simulation } from './simulation';

export type StatsListener = (stats: SimulationStats) => void;

const MAX_STEPS_PER_FRAME = 60;
const PHYSICS_BUDGET_MS = 10;
const STATS_INTERVAL_S = 0.5;

/**
 * Fixed-timestep physics clock. It is driven externally (by the renderer's
 * frame loop) so the app never runs two competing animation loops.
 */
export class SimulationLoop {
  private simulation: Simulation | null = null;
  private running = false;
  private accumulator = 0;
  private speed = 1;
  private externalLease: string | null = null;
  private leaseSequence = 0;

  private statsWindow = 0;
  private statsFrames = 0;
  private statsSteps = 0;
  private statsPhysicsMs = 0;
  private readonly listeners = new Set<StatsListener>();

  get isRunning(): boolean {
    return this.running;
  }

  get playbackSpeed(): number {
    return this.speed;
  }

  get isExternallyControlled(): boolean {
    return this.externalLease !== null;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.05, speed);
  }

  setSimulation(simulation: Simulation | null): void {
    this.simulation = simulation;
    this.accumulator = 0;
    this.running = false;
    this.externalLease = null;
    this.emit();
  }

  subscribe(listener: StatsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  play(): void {
    if (this.externalLease) return;
    this.running = true;
    this.accumulator = 0;
  }

  pause(): void {
    this.running = false;
    // Publish the paused time now instead of at the end of the stats window.
    this.emit();
  }

  toggle(): void {
    if (this.running) this.pause();
    else this.play();
  }

  /** Advances the simulation by `count` steps regardless of play state. */
  step(count = 1): void {
    if (this.externalLease) return;
    this.simulation?.step(count);
    this.emit();
  }

  reset(): void {
    if (this.externalLease) return;
    this.simulation?.reset();
    this.accumulator = 0;
    this.emit();
  }

  setJointPosition(jointIndex: number, value: number): void {
    if (this.externalLease) return;
    this.simulation?.setJointPosition(jointIndex, value);
    this.emit();
  }

  setJointPositions(positions: readonly { jointIndex: number; value: number }[]): void {
    if (this.externalLease) return;
    this.simulation?.setJointPositions(positions);
    this.emit();
  }

  setActuatorControl(actuatorIndex: number, value: number): void {
    if (this.externalLease) return;
    this.simulation?.setActuatorControl(actuatorIndex, value);
    this.emit();
  }

  captureResetPose(): void {
    if (this.externalLease || this.running) return;
    this.simulation?.captureResetPose();
    this.emit();
  }

  clearResetPose(): void {
    if (this.externalLease || this.running) return;
    this.simulation?.clearResetPose();
    this.emit();
  }

  getResetPoseJointPositions(): Record<string, number> | null {
    return this.simulation?.getResetPoseJointPositions() ?? null;
  }

  setResetPose(positions: Readonly<Record<string, number>>): void {
    if (this.externalLease || this.running) return;
    this.simulation?.setResetPose(positions);
    this.emit();
  }

  acquireExternalControl(): string {
    if (this.externalLease) throw new Error('External simulation control is already leased.');
    this.externalLease = `external-lease-${++this.leaseSequence}`;
    this.running = false;
    this.accumulator = 0;
    this.emit();
    return this.externalLease;
  }

  /** False once the lease was released or invalidated (loading another simulation drops it). */
  holdsExternalControl(lease: string): boolean {
    return this.externalLease !== null && this.externalLease === lease;
  }

  releaseExternalControl(lease: string): void {
    this.assertExternalLease(lease);
    this.externalLease = null;
    this.running = false;
    this.accumulator = 0;
    this.emit();
  }

  externalStep(lease: string, count: number): void {
    this.assertExternalLease(lease);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error('External physics step count must be a positive integer.');
    }
    this.simulation?.step(count);
    this.emit();
  }

  externalReset(lease: string): void {
    this.assertExternalLease(lease);
    this.simulation?.reset();
    this.accumulator = 0;
    this.emit();
  }

  externalSnapshot(lease: string, snapshot: RemoteSimulationSnapshot): void {
    this.assertExternalLease(lease);
    this.simulation?.applyRemoteSnapshot(snapshot);
    this.emit();
  }

  /** Called once per rendered frame with the elapsed wall-clock seconds. */
  advance(delta: number): void {
    const sim = this.simulation;
    const clamped = Math.min(delta, 0.1);

    let steps = 0;
    let physicsMs = 0;

    if (sim && this.running && !this.externalLease) {
      this.accumulator += clamped * this.speed;
      const dt = sim.timestep;
      const startedAt = performance.now();
      while (
        this.accumulator >= dt &&
        steps < MAX_STEPS_PER_FRAME &&
        performance.now() - startedAt < PHYSICS_BUDGET_MS
      ) {
        sim.step();
        this.accumulator -= dt;
        steps++;
      }
      physicsMs = performance.now() - startedAt;
      // Drop the backlog rather than spiralling when the tab cannot keep up.
      if (this.accumulator >= dt) this.accumulator = 0;
    }

    this.statsWindow += clamped;
    this.statsFrames++;
    this.statsSteps += steps;
    this.statsPhysicsMs += physicsMs;
    if (this.statsWindow >= STATS_INTERVAL_S) {
      this.emit();
      this.statsWindow = 0;
      this.statsFrames = 0;
      this.statsSteps = 0;
      this.statsPhysicsMs = 0;
    }
  }

  private emit(): void {
    const frames = Math.max(this.statsFrames, 1);
    const window = Math.max(this.statsWindow, 1e-3);
    const stats: SimulationStats = {
      time: this.simulation?.time ?? 0,
      fps: Math.round(this.statsFrames / window),
      stepsPerSecond: Math.round(this.statsSteps / window),
      physicsMs: this.statsPhysicsMs / frames,
    };
    for (const listener of this.listeners) listener(stats);
  }

  private assertExternalLease(lease: string): void {
    if (!this.externalLease || this.externalLease !== lease) {
      throw new Error('External simulation control lease is no longer valid.');
    }
  }
}
