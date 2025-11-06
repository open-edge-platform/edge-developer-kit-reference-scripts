// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PrerequisiteBannerProps {
  inactivePrerequisites: string[]
  preparingPrerequisites: string[]
  isLoading: boolean
  onStart: () => void
  isStarting: boolean
}

export function PrerequisiteBanner({
  inactivePrerequisites,
  preparingPrerequisites,
  isLoading,
  onStart,
  isStarting,
}: PrerequisiteBannerProps) {
  if (
    inactivePrerequisites.length === 0 &&
    preparingPrerequisites.length === 0
  ) {
    return null
  }

  return (
    <>
      {inactivePrerequisites.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-center justify-between">
            <div>
              {isLoading ? (
                <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                  Loading...
                </h3>
              ) : (
                <>
                  <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                    Prerequisites Required
                  </h3>
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    The following services need to be started:{' '}
                    {inactivePrerequisites.join(', ')}
                  </p>
                </>
              )}
            </div>
            <Button
              onClick={onStart}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={
                isStarting || preparingPrerequisites.length > 0 || isLoading
              }
              size="sm"
            >
              <Play className="mr-2 h-4 w-4" />
              {isStarting ? 'Starting...' : 'Start All Services'}
            </Button>
          </div>
        </div>
      )}

      {preparingPrerequisites.length > 0 && (
        <div className="border-b border-blue-200 bg-blue-50 px-6 py-3 dark:border-blue-800 dark:bg-blue-900/20">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 animate-pulse rounded-full bg-blue-600"></div>
            <div>
              <h3 className="font-semibold text-blue-800 dark:text-blue-200">
                Prerequisites Starting
              </h3>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                The following services are currently starting:{' '}
                <strong>{preparingPrerequisites.join(', ')}</strong>. Please
                wait for them to finish.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
