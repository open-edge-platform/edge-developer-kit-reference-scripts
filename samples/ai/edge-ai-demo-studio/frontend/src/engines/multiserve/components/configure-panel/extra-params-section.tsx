// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronDown } from 'lucide-react'
import { SectionHeading } from '@/components/configure/config-section'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'

/** Extra `ovms --pull` options for downloading and converting a model, folded away. */
export function ExtraParamsSection({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Collapsible className="group space-y-2 px-2">
      <CollapsibleTrigger className="focus-visible:ring-ring/50 flex w-full items-center justify-between rounded-sm outline-none focus-visible:ring-[3px]">
        <SectionHeading as="span">Conversion Parameters</SectionHeading>
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2">
        <Input
          aria-label="Conversion parameters"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            'e.g., --extra_quantization_params "--ratio 0.8 --group-size 128"'
          }
          spellCheck={false}
          className="font-mono text-xs"
        />
        <p className="text-muted-foreground text-xs">
          Extra options for downloading and converting the model (optional),
          used when it is first downloaded. Quote values that contain spaces.
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}
