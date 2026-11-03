// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { TriangleAlert } from 'lucide-react'
import { useId } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { ConfigSection } from '@/components/configure/config-section'
import {
  DeviceSelect,
  type DeviceSelectProps,
} from '@/components/configure/device-select'
import { getBackend } from '@/engines/multiserve/backends'
import type { BackendId } from '@/engines/multiserve/types'

/** Device picker, with a notice naming the backend when its devices could not be fetched. */
export function AcceleratorSection({
  backend,
  value,
  onValueChange,
  options,
  isLoading,
  isError,
  onRetry,
}: { backend: BackendId } & Pick<
  DeviceSelectProps,
  'value' | 'onValueChange' | 'options' | 'isLoading' | 'isError' | 'onRetry'
>) {
  const fieldId = useId()
  return (
    <ConfigSection title="Accelerator">
      <DeviceSelect
        id={`${fieldId}-device`}
        value={value}
        onValueChange={onValueChange}
        options={options}
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        errorContent={
          <InlineNotice
            tone="destructive"
            icon={
              <TriangleAlert
                aria-hidden="true"
                className="text-destructive h-3.5 w-3.5 shrink-0"
              />
            }
          >
            Failed to fetch devices for the{' '}
            <span className="font-medium">
              {getBackend(backend)?.name ?? backend}
            </span>{' '}
            backend. Check that the backend runtime is installed.
          </InlineNotice>
        }
      />
    </ConfigSection>
  )
}
