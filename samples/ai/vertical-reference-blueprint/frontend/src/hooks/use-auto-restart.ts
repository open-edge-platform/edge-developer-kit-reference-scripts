// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The kiosk clears itself down between citizens.
 *
 * A finished request leaves someone's name, case id and receipt on a screen
 * in a public hall, and the next person in the queue should not have to work
 * out how to get back to the start. So once a request ends the kiosk counts
 * down and then wipes the session — while offering the citizen who is still
 * reading their receipt a way to hold it.
 *
 * The countdown is shown on purpose: a screen that blanks without warning
 * looks broken, and a citizen mid-receipt needs a button to press rather than
 * a surprise.
 */

/** How long a finished request stays on screen before the kiosk clears it. */
const RESTART_SECONDS = Math.max(
  1,
  Math.round((Number(process.env.NEXT_PUBLIC_KIOSK_RESTART_MS) || 30_000) / 1000),
);

/** How long a session may sit untouched before the kiosk clears it down. */
const IDLE_MS = Number(process.env.NEXT_PUBLIC_KIOSK_IDLE_MS) || 60_000;

export type AutoRestart = {
  /** Seconds left before the wipe, or null when nothing is counting down. */
  secondsLeft: number | null;
  /** "I need more time" — stop this session's countdown for good. */
  hold: () => void;
  /** The citizen held the kiosk; it will not clear itself down on its own. */
  held: boolean;
};

export function useAutoRestart({
  when,
  paused,
  onRestart,
}: {
  /** The request is finished — start counting down. */
  when: boolean;
  /** Hold the clock without cancelling it (the kiosk is still talking). */
  paused?: boolean;
  onRestart: () => void;
}): AutoRestart {
  // Each finished request gets its own countdown: leaving the finished state
  // re-arms the clock, including for a citizen who held the previous one.
  const fresh = { armed: when, secondsLeft: RESTART_SECONDS, held: false };
  const [clock, setClock] = useState(fresh);
  if (clock.armed !== when) setClock(fresh);
  const { secondsLeft, held } = clock.armed === when ? clock : fresh;

  const counting = when && !held;
  useEffect(() => {
    if (!counting || paused) return;
    const timer = setInterval(
      () => setClock((c) => ({ ...c, secondsLeft: Math.max(0, c.secondsLeft - 1) })),
      1000,
    );
    return () => clearInterval(timer);
  }, [counting, paused]);

  // The timer effect restarts on every tick, so the wipe hangs off the count
  // reaching zero rather than the caller's callback identity.
  const restartRef = useRef(onRestart);
  useEffect(() => {
    restartRef.current = onRestart;
  });
  useEffect(() => {
    if (counting && secondsLeft === 0) restartRef.current();
  }, [counting, secondsLeft]);

  return {
    secondsLeft: counting ? secondsLeft : null,
    hold: () => setClock((c) => ({ ...c, held: true })),
    held,
  };
}

/**
 * The other way a session ends: the citizen simply walks away.
 *
 * Nothing here is a countdown the citizen has to watch — an abandoned kiosk
 * is wiped quietly once it has sat untouched (no tap, no key, no turn of the
 * conversation) for `NEXT_PUBLIC_KIOSK_IDLE_MS`. The clock is held while the
 * kiosk itself is doing something — working, speaking, or waiting on a
 * physical step at the machine — because none of that is the citizen being
 * gone.
 */
export function useIdleRestart({
  enabled,
  paused,
  activity,
  onIdle,
}: {
  /** There is a session worth clearing (an empty kiosk needs no wipe). */
  enabled: boolean;
  /** The kiosk is mid-something — hold the clock without restarting it. */
  paused?: boolean;
  /** Any value that changes when the conversation moves (message count…). */
  activity?: unknown;
  onIdle: () => void;
}): void {
  // Every tap and keypress re-arms the clock by re-running the effect below.
  const [touched, setTouched] = useState(0);

  const idleRef = useRef(onIdle);
  useEffect(() => {
    idleRef.current = onIdle;
  });

  useEffect(() => {
    if (!enabled || paused) return;
    const bump = () => setTouched((n) => n + 1);
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    for (const event of events) window.addEventListener(event, bump);
    const timer = setTimeout(() => idleRef.current(), IDLE_MS);
    return () => {
      clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, bump);
    };
  }, [enabled, paused, activity, touched]);
}
