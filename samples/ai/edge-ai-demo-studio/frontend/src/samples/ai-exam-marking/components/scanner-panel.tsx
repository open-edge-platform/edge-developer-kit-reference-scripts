// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FolderOpen, Wifi, WifiOff } from 'lucide-react'
import { useState } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useGetService } from '@/context/service-status-context'
import { cn } from '@/lib/utils'
import {
  type ScannerConnection,
  useFileWatcherSocket,
} from '../hooks/use-file-watcher-socket'

const STATUS_TEXT: Record<ScannerConnection, string> = {
  connected: 'Ready to receive scanned papers…',
  connecting: 'Connecting…',
  waiting: 'Waiting for the File Watcher to start…',
  disconnected: 'Auto-Grade via Scanner',
}

const ICON_SURFACE: Record<ScannerConnection, string> = {
  connected: 'bg-success/10',
  connecting: 'bg-warning/10',
  waiting: 'bg-warning/10',
  disconnected: 'bg-muted',
}

/** Auto-grading from a scanner: the File Watcher streams each new image in a folder to the queue. */
export function ScannerPanel({
  onImage,
}: {
  /** A scanned sheet, resized, as a data URL. */
  onImage: (dataUrl: string) => void
}) {
  const [active, setActive] = useState(false)
  const [watchedPath, setWatchedPath] = useState('')
  const [dropped, setDropped] = useState<string | null>(null)
  // Allocated while the file watcher runs; undefined when it is stopped.
  const port = useGetService('file-watcher')?.instancePort

  const connection = useFileWatcherSocket({
    port,
    path: watchedPath,
    active,
    onImage,
    onClosed: (failed) => {
      setActive(false)
      setDropped(
        failed
          ? 'Could not reach the File Watcher. Check that it is running and that the folder exists, then connect again.'
          : 'The File Watcher closed the connection. Connect again to keep grading scans.',
      )
    },
  })

  const toggle = () => {
    setDropped(null)
    setActive((v) => !v)
  }

  return (
    <div className="bg-muted/20 rounded-lg border">
      <div className="flex flex-col items-center justify-center gap-4 p-8">
        <div className="w-full space-y-1.5">
          <Label htmlFor="scanner-watch-path" className="text-xs">
            Watched Folder Path
          </Label>
          <div className="relative">
            <FolderOpen
              className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="scanner-watch-path"
              value={watchedPath}
              onChange={(e) => setWatchedPath(e.target.value)}
              placeholder="Enter the path to watch (e.g., /home/user/Documents or C:\Users\John\Documents)"
              disabled={active}
              className="h-8 pl-7 font-mono text-xs"
            />
          </div>
        </div>
        <div className={cn('rounded-full p-4', ICON_SURFACE[connection])}>
          {connection === 'connected' ? (
            <Wifi className="text-success h-10 w-10" aria-hidden />
          ) : (
            <WifiOff className="text-muted-foreground h-10 w-10" aria-hidden />
          )}
        </div>
        <div className="space-y-1 text-center" aria-live="polite">
          <p className="text-foreground text-sm font-medium">
            {STATUS_TEXT[connection]}
          </p>
          <p className="text-muted-foreground text-xs">
            {connection === 'connected'
              ? 'Scan answer sheets to the watched folder — each will be graded automatically as it arrives.'
              : 'Connect and scan answer sheets directly to the watched folder. Each scanned image will be picked up and graded automatically.'}
          </p>
        </div>
        {dropped && !active && (
          <InlineNotice tone="destructive" size="sm" className="w-full">
            {dropped}
          </InlineNotice>
        )}
        <Button
          className="mt-2 text-xs"
          variant={active ? 'destructive' : 'default'}
          onClick={toggle}
        >
          {active ? (
            <>
              <WifiOff className="mr-2 h-4 w-4" aria-hidden />
              Disconnect
            </>
          ) : (
            <>
              <Wifi className="mr-2 h-4 w-4" aria-hidden />
              Connect
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
