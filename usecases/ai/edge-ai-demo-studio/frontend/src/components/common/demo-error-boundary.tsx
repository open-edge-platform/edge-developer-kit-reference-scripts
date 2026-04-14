// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
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
        <div className="border-border bg-muted/10 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center">
          <div className="bg-destructive/10 shadow-destructive/5 mb-4 flex h-16 w-16 items-center justify-center rounded-full shadow-sm">
            <AlertTriangle className="text-destructive h-8 w-8" />
          </div>
          <h3 className="text-foreground text-lg font-semibold">
            {this.props.fallbackLabel ?? 'This demo encountered an error'}
          </h3>
          <p className="text-muted-foreground mt-2 max-w-md text-sm">
            Something went wrong while rendering this demo. Try again or check
            the service configuration.
          </p>
          <Button
            className="mt-6 gap-2"
            variant="outline"
            onClick={() => this.setState({ hasError: false })}
          >
            <RotateCcw className="h-4 w-4" />
            Try Again
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
