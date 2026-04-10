// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { Eye, EyeOff, Monitor, Moon, Save, Sun, Timer } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { type Theme, useSettings } from '@/context/settings-context'
import { cn } from '@/lib/utils'

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

function formatTimeout(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

// ─── Section wrapper ──────────────────────────────────────────────

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

// ─── Appearance ───────────────────────────────────────────────────

function AppearanceSection({
  theme,
  onThemeChange,
}: {
  theme: Theme
  onThemeChange: (t: Theme) => void
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

// ─── API Configuration ────────────────────────────────────────────

function ApiConfigSection({
  hfToken,
  onTokenChange,
}: {
  hfToken: string
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
              onChange={(e) => onTokenChange(e.target.value)}
              placeholder="hf_xxxxxxxxxxxxxxxxxxxx"
              className="bg-muted/30 pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2 p-0"
              onClick={() => setShowToken(!showToken)}
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

// ─── Service Health ───────────────────────────────────────────────

function ServiceHealthSection({
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
            onChange={(e) =>
              onTimeoutChange(Math.max(30, Number(e.target.value) || 30))
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

// ─── Actions bar ──────────────────────────────────────────────────

function ActionsBar({ saved, onSave }: { saved: boolean; onSave: () => void }) {
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

// ─── Page ─────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings()
  const [saved, setSaved] = useState(false)
  const [startupTimeoutDraft, setStartupTimeout] = useState<number | null>(null)

  const { data: timeoutData } = useQuery({
    queryKey: ['startup-timeout'],
    queryFn: () =>
      fetch('/api/settings/startup-timeout').then((r) => r.json()) as Promise<{
        startupTimeout: number
      }>,
  })

  const startupTimeout =
    startupTimeoutDraft ?? timeoutData?.startupTimeout ?? 600

  const showSaved = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const { mutate: saveHfToken } = useMutation({
    mutationFn: (hfToken: string) =>
      fetch('/api/settings/hf-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hfToken }),
      }),
    onSuccess: showSaved,
  })

  const { mutate: saveStartupTimeout } = useMutation({
    mutationFn: (timeout: number) =>
      fetch('/api/settings/startup-timeout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startupTimeout: timeout }),
      }),
    onSuccess: showSaved,
  })

  const handleSave = () => {
    saveHfToken(settings.hfToken)
    saveStartupTimeout(startupTimeout)
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-foreground text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure your Edge AI Demo Studio preferences.
        </p>
      </div>

      <AppearanceSection
        theme={settings.theme}
        onThemeChange={(theme) => updateSettings({ theme })}
      />

      <ApiConfigSection
        hfToken={settings.hfToken}
        onTokenChange={(hfToken) => updateSettings({ hfToken })}
      />

      <ServiceHealthSection
        startupTimeout={startupTimeout}
        onTimeoutChange={setStartupTimeout}
      />

      <ActionsBar saved={saved} onSave={handleSave} />
    </div>
  )
}
