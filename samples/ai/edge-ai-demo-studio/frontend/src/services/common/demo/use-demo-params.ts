// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { Setters } from '@/hooks/use-param-state'
import { useSessionState } from './session-store'

export interface UseDemoParamsOptions<T> {
  /** Session key (`demoStateKey(service, '<demo>:params')`), so values come back on remount. */
  sessionKey?: string
  /** Values to start from instead of the defaults (a sample's preset). */
  initial?: Partial<T>
}

export interface DemoParamsState<T> {
  values: T
  /** Sets one field; a value equal to the current one changes nothing. */
  set: <K extends keyof T>(key: K, value: T[K]) => void
  /** `setX` per field, e.g. `setSpeed(1.2)`. */
  setters: Setters<T>
  /** Back to the defaults (with `initial` applied). */
  reset: () => void
  /** Every field still has its starting value. */
  isDefault: boolean
}

function startingValues<T extends object>(defaults: T, initial?: Partial<T>) {
  const merged = { ...defaults }
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = initial?.[key]
    if (value !== undefined) merged[key] = value as T[keyof T]
  }
  return merged
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** A demo sidebar's parameters: one object with a setter per field, kept per `sessionKey`. */
export function useDemoParams<T extends object>(
  defaults: T,
  { sessionKey, initial }: UseDemoParamsOptions<T> = {},
): DemoParamsState<T> {
  const [values, setValues] = useSessionState<T>(sessionKey, () =>
    startingValues(defaults, initial),
  )

  const set = <K extends keyof T>(key: K, value: T[K]) =>
    setValues((prev) =>
      Object.is(prev[key], value) ? prev : { ...prev, [key]: value },
    )

  const setters = {} as Record<string, (value: unknown) => void>
  for (const key of Object.keys(defaults) as (keyof T & string)[]) {
    setters[`set${capitalize(key)}`] = (value) =>
      set(key, value as T[typeof key])
  }

  const start = startingValues(defaults, initial)
  const isDefault = (Object.keys(start) as (keyof T)[]).every((key) =>
    Object.is(values[key], start[key]),
  )

  return {
    values,
    set,
    setters: setters as Setters<T>,
    reset: () => setValues(startingValues(defaults, initial)),
    isDefault,
  }
}
