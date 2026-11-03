// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/empty-state'
import { logger } from '@/lib/logger'

interface Props {
  children: ReactNode
  fallbackLabel?: string
}

interface State {
  hasError: boolean
}

export class DemoErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Demo component error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <EmptyState
          icon={AlertTriangle}
          tone="destructive"
          title={this.props.fallbackLabel ?? 'This demo encountered an error'}
          description="Something went wrong while rendering this demo. Try again or check the service configuration."
        >
          <Button
            className="mt-6 gap-2"
            variant="outline"
            onClick={() => this.setState({ hasError: false })}
          >
            <RotateCcw className="h-4 w-4" />
            Try Again
          </Button>
        </EmptyState>
      )
    }

    return this.props.children
  }
}
