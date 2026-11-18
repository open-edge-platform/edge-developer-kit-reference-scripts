// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback: (message: string) => ReactNode;
}

interface State {
  message: string | null;
}

/** Keeps a failed WebGL context from taking down the whole editor shell. */
export class ViewportErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Viewport failed to render', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.message) return this.props.fallback(this.state.message);
    return this.props.children;
  }
}
