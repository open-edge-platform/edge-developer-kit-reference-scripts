// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type FieldState, SettingsSection } from './settings-section'

/** The field's placeholder: only a loaded status may say a token is saved. */
function tokenPlaceholder(hasToken: boolean | undefined): string {
  if (hasToken === undefined) return ''
  return hasToken
    ? '•••••••• (token saved — enter a new one to replace)'
    : 'hf_xxxxxxxxxxxxxxxxxxxx'
}

export function ApiConfigSection({
  hfToken,
  hasToken,
  onTokenChange,
  state,
}: {
  /** The token being entered; `null` until the user types. */
  hfToken: string | null
  /** Whether a token is saved; undefined until that has loaded. */
  hasToken: boolean | undefined
  onTokenChange: (token: string) => void
  state: FieldState
}) {
  const [showToken, setShowToken] = useState(false)
  const loaded = hasToken !== undefined
  // Typing then clearing the field asks to remove the saved token; the
  // server trims what it gets, so blanks alone remove it too.
  const removes = hasToken === true && hfToken?.trim() === ''

  return (
    <SettingsSection
      title="API configuration"
      description="Manage tokens and connection settings."
      stagger={1}
      state={state}
    >
      <div className="space-y-2">
        <Label htmlFor="hf-token">Hugging Face token</Label>
        <div className="relative">
          <Input
            id="hf-token"
            type={showToken ? 'text' : 'password'}
            value={hfToken ?? ''}
            disabled={!loaded}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder={tokenPlaceholder(hasToken)}
            autoComplete="off"
            aria-describedby="hf-token-hint"
            className="bg-muted/30 pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-0.5 -translate-y-1/2"
            aria-label={showToken ? 'Hide token' : 'Show token'}
            aria-pressed={showToken}
            disabled={!loaded}
            onClick={() => setShowToken((value) => !value)}
          >
            {showToken ? (
              <EyeOff aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Eye aria-hidden="true" className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p id="hf-token-hint" className="text-muted-foreground text-xs">
          {removes
            ? 'Saving with the field empty removes the saved token.'
            : 'Required for downloading models from Hugging Face Hub. Token is encrypted and stored in the database.'}
        </p>
      </div>
    </SettingsSection>
  )
}
