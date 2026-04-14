// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowLeft, Ban, Cpu, Monitor } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useSystemInfo } from '@/context/system-info-context'
import { getOSLabel } from '@/services/registry'
import {
  getMissingSampleDevices,
  getSampleSupportedOS,
  isSampleSupportedOnDevices,
  isSampleSupportedOnOS,
} from '@/samples/registry'
import type { Sample } from '@/samples/types'

interface SampleOSGuardProps {
  sample: Sample
  children: React.ReactNode
}

export function SampleOSGuard({ sample, children }: SampleOSGuardProps) {
  const { systemInfo, loading } = useSystemInfo()

  if (loading || !systemInfo) {
    return <>{children}</>
  }

  const osSupported = isSampleSupportedOnOS(sample, systemInfo.os)
  const devicesSupported = isSampleSupportedOnDevices(
    sample,
    systemInfo.devices,
  )

  if (osSupported && devicesSupported) {
    return <>{children}</>
  }

  const supportedList = getSampleSupportedOS(sample)
  const missingDevices = getMissingSampleDevices(sample, systemInfo.devices)

  return (
    <div className="space-y-8">
      <Link
        href="/samples"
        className="group text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition-colors"
      >
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
        Back to Samples
      </Link>

      <div className="flex flex-col items-center justify-center py-20">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange-500/10">
          <Ban className="h-8 w-8 text-orange-400" />
        </div>
        <h2 className="text-foreground text-xl font-bold">
          Sample Not Available
        </h2>

        {!osSupported && (
          <p className="text-muted-foreground mt-2 max-w-md text-center text-sm leading-relaxed">
            <span className="text-foreground font-semibold">
              {sample.title}
            </span>{' '}
            is not supported on{' '}
            <span className="font-semibold text-orange-400">
              {getOSLabel(systemInfo.os)}
            </span>
            .
          </p>
        )}

        {!osSupported && supportedList.length > 0 && (
          <div className="mt-4 flex items-center gap-2">
            <Monitor className="text-muted-foreground h-4 w-4" />
            <span className="text-muted-foreground text-sm">
              Supported on:{' '}
              <span className="text-foreground font-medium">
                {supportedList.map(getOSLabel).join(', ')}
              </span>
            </span>
          </div>
        )}

        {missingDevices.length > 0 && (
          <p className="text-muted-foreground mt-2 max-w-md text-center text-sm leading-relaxed">
            <span className="text-foreground font-semibold">
              {sample.title}
            </span>{' '}
            requires a{' '}
            <span className="font-semibold text-orange-400">
              {missingDevices.map((d) => d.toUpperCase()).join(', ')}
            </span>{' '}
            device which was not detected on this system.
          </p>
        )}

        {missingDevices.length > 0 && (
          <div className="mt-4 flex items-center gap-2">
            <Cpu className="text-muted-foreground h-4 w-4" />
            <span className="text-muted-foreground text-sm">
              Required devices:{' '}
              <span className="text-foreground font-medium">
                {sample.requiredDevices?.map((d) => d.toUpperCase()).join(', ')}
              </span>
            </span>
          </div>
        )}

        <Button asChild variant="outline" size="sm" className="mt-6 gap-2">
          <Link href="/samples">
            <ArrowLeft className="h-3.5 w-3.5" />
            Browse Samples
          </Link>
        </Button>
      </div>
    </div>
  )
}
