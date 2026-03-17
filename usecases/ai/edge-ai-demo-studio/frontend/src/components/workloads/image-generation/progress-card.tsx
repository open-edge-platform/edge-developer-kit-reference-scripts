// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Card, CardContent } from '@/components/ui/card'
import { Loader2, Clock } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { useMemo } from 'react'
import { ImageGenerationTaskStatus } from '@/types/image-generation'

export function ProgressCard({
  taskType,
  taskStatus,
}: {
  taskType: 'generation' | 'edit'
  taskStatus: ImageGenerationTaskStatus
}) {
  const progressPct = useMemo(() => {
    if (!taskStatus) return 0

    const {
      status,
      elapsed_time: elapsedTime,
      estimated_time: estimatedTime,
    } = taskStatus
    const elapsedSeconds = Math.round(elapsedTime)
    const estimatedSeconds = estimatedTime ? Math.round(estimatedTime) : null

    switch (status) {
      case 'pending':
        return 0
      case 'in_progress':
        if (estimatedSeconds) {
          return Math.min((elapsedSeconds / estimatedSeconds) * 100, 95)
        }
        return 0
      case 'completed':
        return 100
      case 'failed':
        return 0
      default:
        return 0
    }
  }, [taskStatus])

  const formatTime = (seconds: number) => {
    if (seconds < 60) {
      return `${seconds}s`
    }
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
  }

  const getStatusInfo = () => {
    if (!taskStatus) {
      return {
        message: '',
        showProgress: false,
        variant: 'default' as const,
      }
    }

    const {
      status,
      elapsed_time: elapsedTime,
      estimated_time: estimatedTime,
    } = taskStatus
    const elapsedSeconds = Math.round(elapsedTime)
    const estimatedSeconds = estimatedTime ? Math.round(estimatedTime) : null
    const remainingSeconds = estimatedSeconds
      ? Math.max(0, estimatedSeconds - elapsedSeconds)
      : null

    switch (status) {
      case 'pending':
        return {
          message: `Preparing to ${taskType == 'generation' ? 'generate' : 'edit'}...`,
          showProgress: false,
          variant: 'default' as const,
        }
      case 'in_progress':
        if (remainingSeconds !== null) {
          return {
            message:
              `${formatTime(elapsedSeconds)} elapsed` +
              (remainingSeconds > 0
                ? ` • ~${formatTime(remainingSeconds)} remaining`
                : ''),
            showProgress: true,
            variant: 'default' as const,
          }
        }
        return {
          message: `${formatTime(elapsedSeconds)} elapsed • Estimating time...`,
          showProgress: true,
          variant: 'default' as const,
        }
      case 'completed':
        return {
          message: `Completed in ${formatTime(elapsedSeconds)}`,
          showProgress: true,
          variant: 'success' as const,
        }
      case 'failed':
        return {
          message: `${taskType == 'generation' ? 'Generation' : 'Edit'} failed`,
          showProgress: false,
          variant: 'destructive' as const,
        }
      default:
        return {
          message: '',
          showProgress: false,
          variant: 'default' as const,
        }
    }
  }

  const statusInfo = getStatusInfo()

  return (
    <Card>
      <CardContent className="space-y-6">
        {taskStatus && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {taskStatus.status === 'in_progress' && (
                  <Loader2 className="text-primary h-4 w-4 animate-spin" />
                )}
                {taskStatus.status === 'completed' && (
                  <div className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500">
                    <svg
                      className="h-3 w-3 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                )}
                {taskStatus.status === 'pending' && (
                  <Clock className="text-muted-foreground h-4 w-4" />
                )}
                <span className="text-sm font-medium">
                  {taskStatus.status === 'pending' && 'Pending'}
                  {taskStatus.status === 'in_progress' && 'In Progress'}
                  {taskStatus.status === 'completed' && 'Complete'}
                  {taskStatus.status === 'failed' && 'Failed'}
                </span>
              </div>
              <span className="text-muted-foreground text-xs">
                {statusInfo.message}
              </span>
            </div>
            {statusInfo.showProgress && (
              <Progress value={progressPct} className="h-2" />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
