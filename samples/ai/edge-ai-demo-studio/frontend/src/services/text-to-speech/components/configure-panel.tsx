// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronRight, Globe, Mic } from 'lucide-react'
import { ConfigSection } from '@/components/configure/config-section'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useConfigureDraftHost } from '@/hooks/use-configure-draft'
import { plural } from '@/lib/browser/format'
import { WorkerConfigurePanel } from '@/services/common/configure/worker-configure-panel'
import type { Service } from '@/services/types'
import { getLanguagesForModel, getVoicesForModel } from '../lib/tts-models'

/**
 * The drafted model's languages and voice counts. A reference, not a setting, so it starts
 * folded in the New instance sheet and open in Runtime Settings.
 */
function TtsVoicesSection({
  model,
  defaultOpen,
}: {
  model: string
  defaultOpen: boolean
}) {
  const languages = getLanguagesForModel(model)
  const voices = getVoicesForModel(model)
  const voiceCounts = new Map<string, number>()
  for (const v of voices) {
    voiceCounts.set(v.language, (voiceCounts.get(v.language) ?? 0) + 1)
  }

  return (
    <ConfigSection title="Available Voices">
      <p className="text-muted-foreground text-xs">
        Language and voice can be configured in the demo panel at runtime.
      </p>
      <Collapsible defaultOpen={defaultOpen} className="group/voices space-y-2">
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Globe aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span>{plural(languages.length, 'language')}</span>
          <span aria-hidden className="text-muted-foreground/50">
            ·
          </span>
          <Mic aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span data-testid="tts-voices-count">
            {plural(voices.length, 'voice')}
          </span>
          {voiceCounts.size > 0 && (
            <CollapsibleTrigger
              data-testid="tts-voices-toggle"
              className="text-primary hover:bg-muted/60 focus-visible:ring-ring/50 ml-auto inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium outline-none focus-visible:ring-[3px]"
            >
              <ChevronRight
                aria-hidden="true"
                className="h-3.5 w-3.5 transition-transform duration-150 group-data-[state=open]/voices:rotate-90"
              />
              <span className="group-data-[state=open]/voices:hidden">
                Show voices by language
              </span>
              <span className="hidden group-data-[state=open]/voices:inline">
                Hide voices by language
              </span>
            </CollapsibleTrigger>
          )}
        </div>
        {voiceCounts.size > 0 && (
          <CollapsibleContent>
            <ul
              data-testid="tts-voices-list"
              className="divide-border max-h-44 divide-y overflow-y-auto rounded-md border"
            >
              {[...voiceCounts].map(([language, count]) => (
                <li
                  key={language}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                >
                  <span className="truncate text-xs">{language}</span>
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-xs tabular-nums"
                  >
                    {plural(count, 'voice')}
                  </Badge>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        )}
      </Collapsible>
    </ConfigSection>
  )
}

/** Worker settings with the drafted model's voices between the model and the device. */
export function TtsConfigurePanel({ service }: { service: Service }) {
  const drafting = useConfigureDraftHost() !== null
  return (
    <WorkerConfigurePanel
      service={service}
      listPresetsBy="label"
      modelSelectTestId="tts-cfg-model"
      renderAfterModel={({ model }) => (
        <TtsVoicesSection model={model} defaultOpen={!drafting} />
      )}
    />
  )
}
