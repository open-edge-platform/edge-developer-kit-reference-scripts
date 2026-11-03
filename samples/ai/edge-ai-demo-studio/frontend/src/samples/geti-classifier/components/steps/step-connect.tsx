// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ArrowRight, Globe, Lock, Plug, RefreshCw, Server } from 'lucide-react'
import type { FormEvent } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { GetiConnection } from '../../lib/api'
import { PhaseBanner } from '../phase-banner'

const FIELD_LABEL_CLASS =
  'text-muted-foreground text-xs font-semibold tracking-wider uppercase'

interface StepConnectProps {
  value: GetiConnection
  onChange: (value: GetiConnection) => void
  /** Why connecting failed (or what is missing), if it did. */
  error: string | null
  isConnecting: boolean
  onConnect: () => void
}

/** Wizard step 1: the Geti server, its access token, and how to trust it. */
export function StepConnect({
  value,
  onChange,
  error,
  isConnecting,
  onConnect,
}: StepConnectProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onConnect()
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-lg space-y-6">
      <PhaseBanner
        phase="connect"
        icon={Globe}
        title="Intel Geti Platform"
        subtitle="Connect to GETI"
      />

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="geti-host" className={FIELD_LABEL_CLASS}>
            Geti Server URL
          </Label>
          <div className="relative">
            <Server
              className="text-muted-foreground absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="geti-host"
              value={value.host}
              onChange={(e) => onChange({ ...value, host: e.target.value })}
              placeholder="https://192.168.1.100"
              aria-describedby="geti-host-hint"
              className="bg-background border-2 pl-9"
            />
          </div>
          <p id="geti-host-hint" className="text-muted-foreground text-xs">
            Full URL including protocol (https://)
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="geti-token" className={FIELD_LABEL_CLASS}>
            Personal Access Token
          </Label>
          <div className="relative">
            <Lock
              className="text-muted-foreground absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="geti-token"
              type="password"
              value={value.token}
              onChange={(e) => onChange({ ...value, token: e.target.value })}
              placeholder="geti_pat_..."
              aria-describedby="geti-token-hint"
              className="bg-background border-2 pl-9"
            />
          </div>
          <p id="geti-token-hint" className="text-muted-foreground text-xs">
            Geti → Profile → Personal Access Tokens
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-1">
            <Label htmlFor="geti-verify-tls" className="text-sm">
              Verify TLS certificate
            </Label>
            <p
              id="geti-verify-tls-hint"
              className="text-muted-foreground text-xs"
            >
              Off by default: an on-premises Geti server usually has a
              self-signed certificate, which verification would reject. Turn it
              on when the server&apos;s certificate is issued by an authority
              this machine trusts, so the token is only ever sent to that
              server.
            </p>
          </div>
          <Switch
            id="geti-verify-tls"
            checked={value.verifyTls}
            onCheckedChange={(verifyTls) => onChange({ ...value, verifyTls })}
            aria-describedby="geti-verify-tls-hint"
            className="mt-0.5 shrink-0"
          />
        </div>
      </div>

      {error && (
        <InlineNotice tone="destructive" size="sm">
          <span className="font-medium">Connection Failed.</span> {error}
        </InlineNotice>
      )}

      <Button
        type="submit"
        className="w-full gap-2"
        size="lg"
        disabled={isConnecting}
        aria-busy={isConnecting || undefined}
      >
        {isConnecting ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
            Connecting to Geti...
          </>
        ) : (
          <>
            <Plug className="h-4 w-4" aria-hidden />
            Connect &amp; Load Projects
            <ArrowRight className="ml-auto h-4 w-4" aria-hidden />
          </>
        )}
      </Button>
    </form>
  )
}
