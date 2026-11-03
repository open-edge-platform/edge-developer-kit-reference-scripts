// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

type Slot<T> = { pending: { value: T; at: number } | null; waiting: Set<(value: T) => void> };

/** Hands what was presented to whoever waits, else holds it `ttlMs`; on globalThis so every route bundle shares it. */
export function handoff<T>(key: string, ttlMs: number) {
  const symbol = Symbol.for(key);
  const slot = (): Slot<T> => {
    const globals = globalThis as { [key: symbol]: Slot<T> | undefined };
    return (globals[symbol] ??= { pending: null, waiting: new Set() });
  };

  function present(value: T): void {
    const box = slot();
    const waiting = [...box.waiting];
    box.waiting.clear();
    if (waiting.length === 0) {
      box.pending = { value, at: Date.now() };
      return;
    }
    box.pending = null;
    for (const resolve of waiting) resolve(value);
  }

  function take(): T | null {
    const box = slot();
    const pending = box.pending;
    box.pending = null;
    return pending && Date.now() - pending.at < ttlMs ? pending.value : null;
  }

  /** The next one presented, or null when `timeoutMs` passes or `signal` aborts first. */
  function wait(timeoutMs: number, signal?: AbortSignal): Promise<T | null> {
    const ready = take();
    if (ready !== null) return Promise.resolve(ready);
    const box = slot();
    return new Promise((resolve) => {
      const finish = (value: T | null) => {
        clearTimeout(timer);
        box.waiting.delete(onValue);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onValue = (value: T) => finish(value);
      const onAbort = () => finish(null);
      const timer = setTimeout(() => finish(null), timeoutMs);
      box.waiting.add(onValue);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  return { present, take, wait };
}
