// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { type ActuatorControlState, usePhysics } from '@mujoco-studio/mujoco';
import { Button } from '@mujoco-studio/ui';
import { Pause, Play, RotateCcw } from 'lucide-react';

import { RuntimeValueInput } from './RuntimeValueInput';

const SPEEDS = [0.1, 0.25, 0.5, 1, 2] as const;
// MuJoCo's viewer uses the same fallback range for actuators without ctrlrange.
const UNLIMITED_CONTROL_RANGE = [-1, 1] as const;

export function SimulationPanel() {
  const {
    status,
    stats,
    speed,
    loop,
    getSimulation,
    play,
    pause,
    reset,
    setSpeed,
    setActuatorControl,
  } = usePhysics();
  const simulation = getSimulation();
  const running = loop.isRunning;
  const externallyControlled = loop.isExternallyControlled;
  const locked = status !== 'ready' || !simulation || externallyControlled;
  const actuators = simulation?.getActuatorStates() ?? [];
  const hasJoints = (simulation?.getScalarJointStates().length ?? 0) > 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section aria-label="Playback" className="space-y-3 border-b border-border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
            Playback
          </h3>
          <span
            className="font-mono text-[10px] tabular-nums text-muted-foreground"
            aria-label="Simulation time"
          >
            {stats.time.toFixed(3)} s
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant={running ? 'outline' : 'primary'}
            disabled={locked}
            onClick={running ? pause : play}
          >
            {running ? <Pause /> : <Play />}
            {running ? 'Pause' : 'Play'}
          </Button>
          <Button
            size="sm"
            aria-label="Reset simulation"
            disabled={locked}
            onClick={reset}
            title="Return to the reset pose and clear controls"
          >
            <RotateCcw />
            Reset
          </Button>
        </div>
        <label className="flex items-center justify-between gap-2 text-[10px] text-muted">
          <span>Speed</span>
          <select
            aria-label="Simulation speed"
            className="h-7 border border-border bg-background px-2 text-[10px] text-foreground"
            disabled={locked}
            onChange={(event) => setSpeed(Number(event.target.value))}
            value={speed}
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}x
              </option>
            ))}
          </select>
        </label>
        {simulation && !hasJoints && actuators.length === 0 && (
          <p className="text-[10px] leading-relaxed text-muted">
            This scene has no hinge or slide joints and no actuators.
          </p>
        )}
      </section>

      {actuators.length > 0 && (
        <section aria-label="Actuators" className="border-b border-border px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
              Actuators
            </h3>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {actuators.length} actuators
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-muted">
            Control inputs act while the simulation plays. Reset sets them to zero.
          </p>
          <div className="mt-3 space-y-2.5">
            {actuators.map((actuator) => (
              <ActuatorSlider
                key={actuator.index}
                actuator={actuator}
                disabled={locked}
                onChange={(value) => setActuatorControl(actuator.index, value)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ActuatorSlider({
  actuator,
  disabled,
  onChange,
}: {
  actuator: ActuatorControlState;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [min, max] = actuator.limited ? actuator.range : UNLIMITED_CONTROL_RANGE;
  const inputId = `actuator-control-${actuator.index}`;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <label className="min-w-0 truncate text-muted" htmlFor={inputId} title={actuator.name}>
          {actuator.name}
        </label>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {actuator.limited ? `${min.toFixed(2)} to ${max.toFixed(2)}` : 'unlimited'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          aria-label={`Control for ${actuator.name}`}
          disabled={disabled}
          type="range"
          min={min}
          max={max}
          step="any"
          value={actuator.value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 accent-accent"
        />
        <RuntimeValueInput
          aria-label={`Control value for ${actuator.name}`}
          disabled={disabled}
          min={actuator.limited ? min : undefined}
          max={actuator.limited ? max : undefined}
          value={actuator.value}
          decimals={3}
          onCommit={onChange}
        />
      </div>
    </div>
  );
}
