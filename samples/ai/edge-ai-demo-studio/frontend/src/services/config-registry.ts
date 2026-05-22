// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Service } from '@/payload-types'
import { engines } from '../engines/_generated/meta'
import { metaMap } from './_generated/meta'

export function getServicesPortMap(): Record<string, number> {
  return Object.fromEntries(
    Object.entries(metaMap)
      .filter(([, service]) => service.port !== undefined)
      .map(([key, service]) => [key, service.port as number]),
  )
}

export function getServiceNamesMap(): {
  label: string
  value: Service['type']
}[] {
  const namesMap: { label: string; value: Service['type'] }[] = []
  for (const [key, meta] of Object.entries(metaMap)) {
    namesMap.push({ label: meta.name, value: key as Service['type'] })
  }
  return namesMap
}

export function getEngineOptionsMap(): {
  label: string
  value: Service['engine']
}[] {
  const options: { label: string; value: Service['engine'] }[] = [
    { label: 'Worker', value: 'worker' as Service['engine'] },
  ]
  for (const [id, engine] of Object.entries(engines)) {
    options.push({
      label: engine.name,
      value: id as Service['engine'],
    })
  }
  return options
}
