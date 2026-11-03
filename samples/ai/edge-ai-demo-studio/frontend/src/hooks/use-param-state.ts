// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'

export type Setters<T> = {
  [K in keyof T as `set${Capitalize<string & K>}`]: (value: T[K]) => void
}

function capitalize<S extends string>(value: S): Capitalize<S> {
  return (value.charAt(0).toUpperCase() + value.slice(1)) as Capitalize<S>
}

/** One `useState` for a whole params object, with `set(key, value)` and a stable `setX` per field. */
export function useParamState<T extends object>(
  defaults: T,
  initial?: Partial<T>,
): {
  values: T
  set: <K extends keyof T>(key: K, value: T[K]) => void
  setters: Setters<T>
} {
  const [values, setValues] = useState<T>(() => {
    const merged = { ...defaults }
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      if (initial && initial[key] !== undefined) merged[key] = initial[key]
    }
    return merged
  })

  const set = <K extends keyof T>(key: K, value: T[K]) => {
    setValues((prev) =>
      Object.is(prev[key], value) ? prev : { ...prev, [key]: value },
    )
  }

  const [setters] = useState<Setters<T>>(() => {
    const result = {} as Setters<T>
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const setterName = `set${capitalize(String(key))}` as keyof Setters<T>
      result[setterName] = ((value: T[typeof key]) =>
        set(key, value)) as Setters<T>[typeof setterName]
    }
    return result
  })

  return { values, set, setters }
}
