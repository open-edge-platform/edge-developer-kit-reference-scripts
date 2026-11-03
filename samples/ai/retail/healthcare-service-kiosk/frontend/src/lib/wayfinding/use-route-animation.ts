// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useState } from "react";
import type { Route } from "./routing";

const BASE_SPEED = 1.3; // m/s (average walking speed)
const LOOP_HOLD_MS = 2_000; // a looping walk rests at the destination before setting off again

export interface RouteAnimation {
  distance: number;
  playing: boolean;
  speed: number;
  progress: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  restart: () => void;
  seek: (distance: number) => void;
  setSpeed: (multiplier: number) => void;
}

/**
 * Drives a simulated walk along `route`; `pace` scales the speed at a distance (slower on lifts and escalators).
 * `loop` sets off on its own and walks the route again after each arrival; turning it off pauses, and so does `pause`.
 */
export function useRouteAnimation(
  route: Route | null,
  initialSpeed = 2,
  pace?: (distance: number) => number,
  loop = false,
): RouteAnimation {
  const [distance, setDistance] = useState(0);
  const [requested, setRequested] = useState(loop);
  const [speed, setSpeed] = useState(initialSpeed);
  const [prevRoute, setPrevRoute] = useState(route);
  const [prevLoop, setPrevLoop] = useState(loop);

  // Reset when the route changes (state-from-props pattern)
  if (route !== prevRoute) {
    setPrevRoute(route);
    setDistance(0);
    setRequested(loop);
  }
  if (loop !== prevLoop) {
    setPrevLoop(loop);
    setRequested(loop);
  }

  const total = route?.totalDistance ?? 0;
  const playing = requested && route !== null && distance < total;
  const arrived = route !== null && distance >= total;

  useEffect(() => {
    if (!loop || !requested || !arrived) return;
    const again = setTimeout(() => setDistance(0), LOOP_HOLD_MS);
    return () => clearTimeout(again);
  }, [loop, requested, arrived]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setDistance((d) => Math.min(total, d + dt * BASE_SPEED * speed * (pace?.(d) ?? 1)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total, speed, pace]);

  const seek = useCallback((d: number) => setDistance(Math.max(0, Math.min(total, d))), [total]);

  const play = useCallback(() => {
    if (!route) return;
    setDistance((d) => (d >= total ? 0 : d));
    setRequested(true);
  }, [route, total]);
  const pause = useCallback(() => setRequested(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);
  const restart = useCallback(() => {
    setDistance(0);
    setRequested(true);
  }, []);

  return {
    distance,
    playing,
    speed,
    progress: total > 0 ? distance / total : 0,
    play,
    pause,
    toggle,
    restart,
    seek,
    setSpeed,
  };
}
