// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Theme } from '@/lib/settings/app-settings'
import { cn } from '@/lib/utils'
import { type FieldState, SettingsSection } from './settings-section'

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

export function AppearanceSection({
  theme,
  onThemeChange,
  state,
}: {
  /** The chosen theme; undefined until the saved one has loaded. */
  theme: Theme | undefined
  onThemeChange: (theme: Theme) => void
  state: FieldState
}) {
  const disabled = theme === undefined
  return (
    <SettingsSection
      title="Appearance"
      description="Customize the look and feel of the interface."
      stagger={0}
      state={state}
    >
      <div className="space-y-2">
        <p id="theme-label" className="text-sm leading-none font-medium">
          Theme
        </p>
        <div
          role="group"
          aria-labelledby="theme-label"
          className="flex flex-wrap gap-2"
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              type="button"
              variant={theme === value ? 'secondary' : 'outline'}
              aria-pressed={theme === value}
              disabled={disabled}
              className={cn(
                'theme-btn min-w-24 flex-1 gap-2',
                theme === value &&
                  'border-primary/40 bg-primary/10 text-primary shadow-primary/10 shadow-sm',
              )}
              onClick={() => onThemeChange(value)}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
              {label}
            </Button>
          ))}
        </div>
      </div>
    </SettingsSection>
  )
}
