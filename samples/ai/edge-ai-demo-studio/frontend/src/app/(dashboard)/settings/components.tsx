// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Eye,
  EyeOff,
  Monitor,
  Moon,
  Save,
  Sun,
  Timer,
  TriangleAlert,
} from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import type { Theme } from '@/context/settings-context'
import { cn } from '@/lib/utils'

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

function formatTimeout(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${minutes}m`
}

function SettingsSection({
  title,
  description,
  stagger,
  children,
}: {
  title: string
  description: string
  stagger: number
  children: React.ReactNode
}) {
  return (
    <div
      className="section-fade glass-card space-y-4 rounded-xl p-6"
      style={{ '--stagger': stagger } as React.CSSProperties}
    >
      <div>
        <h2 className="text-foreground text-lg font-semibold">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <Separator />
      {children}
    </div>
  )
}

export function AppearanceSection({
  theme,
  onThemeChange,
}: {
  theme: Theme
  onThemeChange: (theme: Theme) => void
}) {
  return (
    <SettingsSection
      title="Appearance"
      description="Customize the look and feel of the interface."
      stagger={0}
    >
      <div className="space-y-2">
        <Label>Theme</Label>
        <div className="flex gap-2">
          {themeOptions.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={theme === value ? 'secondary' : 'outline'}
              className={cn(
                'theme-btn flex-1 gap-2',
                theme === value &&
                  'border-primary/40 bg-primary/10 text-primary shadow-primary/10 shadow-sm',
              )}
              onClick={() => onThemeChange(value)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Button>
          ))}
        </div>
      </div>
    </SettingsSection>
  )
}

export function ApiConfigSection({
  hfToken,
  hasToken,
  onTokenChange,
}: {
  hfToken: string
  hasToken: boolean
  onTokenChange: (token: string) => void
}) {
  const [showToken, setShowToken] = useState(false)

  return (
    <SettingsSection
      title="API Configuration"
      description="Manage tokens and connection settings."
      stagger={1}
    >
      <div className="space-y-2">
        <Label htmlFor="hf-token">Hugging Face Token</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id="hf-token"
              type={showToken ? 'text' : 'password'}
              value={hfToken}
              onChange={(event) => onTokenChange(event.target.value)}
              placeholder={
                hasToken
                  ? '•••••••• (token saved — enter a new one to replace)'
                  : 'hf_xxxxxxxxxxxxxxxxxxxx'
              }
              className="bg-muted/30 pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2 p-0"
              onClick={() => setShowToken((value) => !value)}
            >
              {showToken ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Required for downloading models from Hugging Face Hub. Token is
          encrypted and stored in the database.
        </p>
      </div>
    </SettingsSection>
  )
}

export function ServiceHealthSection({
  startupTimeout,
  onTimeoutChange,
}: {
  startupTimeout: number
  onTimeoutChange: (value: number) => void
}) {
  return (
    <SettingsSection
      title="Service Health"
      description="Configure health check and startup behavior."
      stagger={2}
    >
      <div className="space-y-2">
        <Label htmlFor="startup-timeout">
          <span className="flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5" />
            Startup Timeout
          </span>
        </Label>
        <div className="flex items-center gap-3">
          <Input
            id="startup-timeout"
            type="number"
            min={30}
            value={startupTimeout}
            onChange={(event) =>
              onTimeoutChange(Math.max(30, Number(event.target.value) || 30))
            }
            className="bg-muted/30 w-32"
          />
          <span className="text-muted-foreground text-sm">
            seconds ({formatTimeout(startupTimeout)})
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          Maximum time a service can stay in &quot;preparing&quot; status before
          being marked as failed. Default is 600 seconds (10 minutes).
        </p>
      </div>
    </SettingsSection>
  )
}

export function ProxyConfigSection({
  activeProxyTimeout,
  proxyTimeout,
  onTimeoutChange,
}: {
  activeProxyTimeout: number | undefined
  proxyTimeout: number
  onTimeoutChange: (value: number) => void
}) {
  return (
    <SettingsSection
      title="Proxy Configuration"
      description="Configure proxy settings."
      stagger={3}
    >
      <div className="space-y-2">
        <Label htmlFor="proxy-timeout">
          <span className="flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5" />
            Proxy Timeout
          </span>
        </Label>
        <div className="flex items-center gap-3">
          <Input
            id="proxy-timeout"
            type="number"
            min={30}
            value={proxyTimeout}
            onChange={(event) =>
              onTimeoutChange(Math.max(30, Number(event.target.value) || 300))
            }
            className="bg-muted/30 w-32"
          />
          <span className="text-muted-foreground text-sm">
            seconds ({formatTimeout(proxyTimeout)})
          </span>
        </div>

        {activeProxyTimeout !== undefined &&
          proxyTimeout !== activeProxyTimeout && (
            <p className="text-muted-foreground text-xs">
              Currently active:{' '}
              <span className="text-foreground font-medium">
                {activeProxyTimeout}s ({formatTimeout(activeProxyTimeout)})
              </span>
            </p>
          )}
        <p className="text-muted-foreground text-xs">
          Maximum time a request can take before being terminated. Default is
          300 seconds (5 minutes). Adjust this if you encounter frequent
          timeouts with long-running requests, but be cautious as setting it too
          high may cause resource exhaustion.
        </p>

        {activeProxyTimeout !== undefined &&
          proxyTimeout !== activeProxyTimeout && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-900 dark:bg-amber-950">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-[11px] text-amber-800 dark:text-amber-200">
                Restart the application to apply this change.
              </p>
            </div>
          )}
      </div>
    </SettingsSection>
  )
}

export function ActionsBar({
  saved,
  onSave,
}: {
  saved: boolean
  onSave: () => void
}) {
  return (
    <div className="flex items-center justify-end">
      <div className="flex items-center gap-3">
        {saved && (
          <Badge className="badge-pop border-success/20 bg-success/15 text-success">
            Settings saved ✓
          </Badge>
        )}
        <Button
          className="bg-primary hover:bg-primary-light shadow-primary/15 gap-2 text-white shadow-md"
          onClick={onSave}
        >
          <Save className="h-4 w-4" />
          Save Changes
        </Button>
      </div>
    </div>
  )
}
