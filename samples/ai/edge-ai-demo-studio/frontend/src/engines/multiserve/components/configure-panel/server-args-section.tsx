// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronDown } from 'lucide-react'
import { useId } from 'react'
import {
  ConfigSection,
  LabelWithTooltip,
} from '@/components/configure/config-section'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import {
  appendServerArg,
  parseServerArgs,
  serverArgHints,
  type ServerArgTask,
} from '@/engines/multiserve/server-args'
import type { BackendId } from '@/engines/multiserve/types'
import { cn } from '@/lib/utils'

const SERVER_NAMES: Record<BackendId, string> = {
  llamacpp: 'llama-server',
  openvino: 'OpenVINO Model Server',
}

const PLACEHOLDERS: Record<BackendId, Record<ServerArgTask, string>> = {
  llamacpp: {
    'text-generation': 'e.g., -c 16384 -np 2',
    embeddings: 'e.g., -ub 4096 --pooling mean',
    rerank: 'e.g., -ub 4096',
  },
  openvino: {
    'text-generation': 'e.g., --max_num_seqs 8 --cache_size 2',
    embeddings: 'e.g., --num_streams 2',
    rerank: 'e.g., --num_streams 2',
  },
}

/** Extra arguments the model server starts with, with the ones it supports to pick from. */
export function ServerArgsSection({
  backend,
  task,
  value,
  onChange,
}: {
  backend: BackendId
  task: ServerArgTask
  value: string
  onChange: (value: string) => void
}) {
  const fieldId = useId()
  const parsed = parseServerArgs(value, backend)
  const hints = serverArgHints(backend, task)
  const server = SERVER_NAMES[backend]

  return (
    <ConfigSection title="Server Arguments" data-testid="cfg-server-args">
      <LabelWithTooltip
        label={`Extra ${server} arguments`}
        htmlFor={`${fieldId}-server-args`}
        tooltip={
          backend === 'llamacpp'
            ? 'Passed to llama-server at every start. A flag given here replaces the value the engine picks for it.'
            : 'Graph options for OpenVINO Model Server, applied at every start. They must suit the task: the model fails to start otherwise.'
        }
      />
      <Input
        id={`${fieldId}-server-args`}
        data-testid="cfg-server-args-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={PLACEHOLDERS[backend][task]}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={!parsed.ok || undefined}
        aria-describedby={`${fieldId}-server-args-note`}
        className="font-mono text-xs"
      />
      <p
        id={`${fieldId}-server-args-note`}
        className={cn(
          'text-xs',
          parsed.ok ? 'text-muted-foreground' : 'text-destructive',
        )}
        data-testid="cfg-server-args-note"
      >
        {parsed.ok
          ? 'Optional. Quote values that contain spaces. They apply the next time the instance starts.'
          : parsed.error}
      </p>
      <Collapsible className="group">
        <CollapsibleTrigger
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex items-center gap-1 rounded-sm text-xs outline-none focus-visible:ring-[3px]"
          data-testid="cfg-server-args-hints-toggle"
        >
          Supported arguments
          <ChevronDown
            aria-hidden="true"
            className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <ul className="border-border divide-border divide-y rounded-md border">
            {hints.map((hint) => (
              <li key={hint.flag}>
                <button
                  type="button"
                  onClick={() => onChange(appendServerArg(value, hint))}
                  className="hover:bg-muted/50 focus-visible:ring-ring/50 flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left outline-none focus-visible:ring-[3px]"
                >
                  <code className="text-foreground text-xs">
                    {hint.flag}
                    {hint.value && (
                      <span className="text-muted-foreground">
                        {' '}
                        {hint.value}
                      </span>
                    )}
                  </code>
                  <span className="text-muted-foreground text-xs">
                    {hint.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-2 text-xs">
            Click one to add it, then adjust its value.{' '}
            {backend === 'llamacpp'
              ? 'Any other llama-server flag works too.'
              : 'Any other ovms --pull graph option for this task works too.'}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </ConfigSection>
  )
}
