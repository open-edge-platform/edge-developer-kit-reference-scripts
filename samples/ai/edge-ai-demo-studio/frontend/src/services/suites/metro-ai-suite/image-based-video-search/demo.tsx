// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ExternalLink, Globe, Lock, Radio } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { Service } from '@/services/types'

function PortRow({
  icon,
  label,
  port,
}: {
  icon: ReactNode
  label: string
  port: number
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="text-muted-foreground flex items-center gap-2">
        {icon}
        <span>{label}</span>
      </div>
      <Badge variant="secondary" className="font-mono text-xs">
        {port}
      </Badge>
    </div>
  )
}

export function ImageBasedVideoSearchDemo({ service }: { service: Service }) {
  const httpPort = service.port ?? 7001
  const httpsPort = httpPort + 1
  const rtspPort = httpPort + 2

  return (
    <div className="space-y-4">
      <div className="border-border bg-muted/10 space-y-3 rounded-xl border p-4">
        <p className="text-foreground text-sm font-medium">Service Ports</p>
        <Separator />
        <div className="space-y-2.5">
          <PortRow
            icon={<Globe className="h-3.5 w-3.5" />}
            label="HTTP"
            port={httpPort}
          />
          <PortRow
            icon={<Lock className="h-3.5 w-3.5" />}
            label="HTTPS"
            port={httpsPort}
          />
          <PortRow
            icon={<Radio className="h-3.5 w-3.5" />}
            label="RTSP"
            port={rtspPort}
          />
        </div>
      </div>

      <Button asChild variant="outline" className="w-full gap-2">
        <a
          href={`https://localhost:${httpsPort}/`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="h-4 w-4" />
          Open Suite UI — https://localhost:{httpsPort}/
        </a>
      </Button>
    </div>
  )
}
