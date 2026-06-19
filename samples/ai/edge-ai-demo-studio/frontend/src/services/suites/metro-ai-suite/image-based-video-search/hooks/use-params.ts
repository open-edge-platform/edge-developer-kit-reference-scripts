// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo, useState } from 'react'
import { useDevicesQuery } from '@/hooks/use-devices'
import type { DemoParam } from '@/types/demo-params'

/** OpenVINO device IDs supported by the DLStreamer pipeline configs. */
const SUPPORTED_DEVICES = ['CPU', 'GPU', 'NPU']

export interface IbvsParamValues {
  device: string
}

export function useIbvsParams(
  initial?: Partial<IbvsParamValues>,
  onDeviceChange?: (device: string) => void,
): { values: IbvsParamValues; params: DemoParam[] } {
  const [device, setDevice] = useState(initial?.device ?? 'CPU')

  const {
    data: openvinoDevices = [],
    isFetching,
    refetch,
  } = useDevicesQuery('openvino')

  const deviceOptions = useMemo(() => {
    const filtered = openvinoDevices.filter((d) =>
      SUPPORTED_DEVICES.some(
        (s) =>
          d.value.toUpperCase() === s ||
          d.value.toUpperCase().startsWith(`${s}.`),
      ),
    )
    return filtered.length > 0
      ? filtered.map((d) => ({ value: d.value, label: d.label }))
      : SUPPORTED_DEVICES.map((d) => ({ value: d, label: d }))
  }, [openvinoDevices])

  const handleChange = (val: string) => {
    setDevice(val)
    onDeviceChange?.(val)
  }

  const params: DemoParam[] = [
    {
      type: 'select',
      id: 'device',
      label: 'Accelerator',
      tooltip:
        'Inference device for the object detection (YOLOv11s) and feature extraction (ResNet-50) pipelines. Takes effect on next start.',
      value: device,
      options: deviceOptions,
      onChange: handleChange,
      onRefresh: () => {
        void refetch()
      },
      isRefreshing: isFetching,
    },
  ]

  return { values: { device }, params }
}
