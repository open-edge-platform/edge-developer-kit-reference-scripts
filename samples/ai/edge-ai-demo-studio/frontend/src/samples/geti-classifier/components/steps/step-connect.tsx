// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  AlertCircle,
  ArrowRight,
  Globe,
  Lock,
  Plug,
  RefreshCw,
  Server,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface StepConnectProps {
  localHost: string
  localToken: string
  hostError: string | null
  isPending: boolean
  isError: boolean
  errorMessage: string | undefined
  onHostChange: (value: string) => void
  onTokenChange: (value: string) => void
  onConnect: () => void
}

export function StepConnect({
  localHost,
  localToken,
  hostError,
  isPending,
  isError,
  errorMessage,
  onHostChange,
  onTokenChange,
  onConnect,
}: StepConnectProps) {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Hero banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 p-6 text-white shadow-xl">
        <div className="absolute -top-8 -right-8 h-32 w-32 rounded-full bg-white/5" />
        <div className="absolute -bottom-4 -left-4 h-20 w-20 rounded-full bg-white/5" />
        <div className="relative">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
              <Globe className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-slate-300">
              Intel Geti Platform
            </span>
          </div>
          <h3 className="text-lg font-bold">Connect to GETI</h3>
        </div>
      </div>

      {/* Form */}
      <div className="space-y-4">
        {/* Server URL */}
        <div className="space-y-2">
          <Label
            htmlFor="geti-host"
            className="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
          >
            Geti Server URL
          </Label>
          <div className="relative">
            <div className="bg-muted absolute top-1/2 left-3 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded">
              <Server className="text-muted-foreground h-3 w-3" />
            </div>
            <Input
              id="geti-host"
              value={localHost}
              onChange={(e) => onHostChange(e.target.value)}
              placeholder="https://192.168.1.100"
              className="bg-background border-2 pl-10 transition-colors focus:border-slate-400"
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Full URL including protocol (https://)
          </p>
        </div>

        {/* API token */}
        <div className="space-y-2">
          <Label
            htmlFor="geti-token"
            className="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
          >
            Personal Access Token
          </Label>
          <div className="relative">
            <div className="bg-muted absolute top-1/2 left-3 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded">
              <Lock className="text-muted-foreground h-3 w-3" />
            </div>
            <Input
              id="geti-token"
              type="password"
              value={localToken}
              onChange={(e) => onTokenChange(e.target.value)}
              placeholder="geti_pat_..."
              className="bg-background border-2 pl-10 transition-colors focus:border-slate-400"
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Geti → Profile → Personal Access Tokens
          </p>
        </div>
      </div>

      {/* Error */}
      {(hostError ?? isError) && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/20">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              Connection Failed
            </p>
            <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
              {hostError ?? errorMessage}
            </p>
          </div>
        </div>
      )}

      {/* CTA */}
      <Button
        className="w-full gap-2 bg-gradient-to-r from-slate-700 to-slate-900 text-white shadow-md hover:from-slate-800 hover:to-slate-950"
        size="lg"
        onClick={onConnect}
        disabled={isPending}
      >
        {isPending ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin" />
            Connecting to Geti...
          </>
        ) : (
          <>
            <Plug className="h-4 w-4" />
            Connect &amp; Load Projects
            <ArrowRight className="ml-auto h-4 w-4" />
          </>
        )}
      </Button>
    </div>
  )
}
