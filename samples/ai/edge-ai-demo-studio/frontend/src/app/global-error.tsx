// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import './(dashboard)/globals.css'
import { useEffect } from 'react'
import { logger } from '@/lib/logger'

/**
 * Last resort when the root layout fails: it replaces the whole document, so it brings its own
 * `<html>`, styles and title and relies on nothing the layout provides.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    logger.error('The app failed to render:', error)
  }, [error])

  return (
    <html lang="en">
      <body className="bg-background text-foreground flex min-h-dvh items-center justify-center p-6 font-sans antialiased">
        <title>Something went wrong · Edge AI Demo Studio</title>
        <main role="alert" className="max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Edge AI Demo Studio couldn’t load
          </h1>
          <p className="text-muted-foreground text-sm">
            Something interrupted the app. Try again; if it keeps happening,
            restart the studio.
            {error.digest && (
              <span className="mt-2 block font-mono text-xs">
                Reference: {error.digest}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="bg-primary text-primary-foreground hover:bg-primary-light rounded-md px-4 py-2 text-sm font-medium"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
