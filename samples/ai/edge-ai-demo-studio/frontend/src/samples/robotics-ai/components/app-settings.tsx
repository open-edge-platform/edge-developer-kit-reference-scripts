// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Settings2 } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { RoboticsMcp } from '../hooks/use-robotics-mcp'
import {
  isRobotLanguage,
  ROBOT_LANGUAGES,
  type RobotLanguage,
  robotLanguageLabel,
} from '../lib/languages'

/** The tool select's value for "let the agent use every tool". */
const ALL_TOOLS = 'all'

interface AppSettingsProps {
  mcp: RoboticsMcp
  language: RobotLanguage
  onLanguageChange: (language: RobotLanguage) => void
  /** The microphone is recording: its language is fixed until it stops. */
  isListening: boolean
  onRecalibrate: () => void
}

/** The app step's collapsible settings, summarised in the header. */
export function AppSettings({
  mcp,
  language,
  onLanguageChange,
  isListening,
  onRecalibrate,
}: AppSettingsProps) {
  return (
    <Accordion
      type="single"
      collapsible
      className="glass-card relative overflow-hidden rounded-xl"
    >
      <AccordionItem value="settings" className="border-none">
        <div className="flex items-center gap-2 pr-6">
          <div className="min-w-0 flex-1">
            <AccordionTrigger className="px-6">
              <span className="flex w-full items-center gap-3 text-left">
                <span className="bg-muted ring-border flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1">
                  <Settings2
                    className="text-muted-foreground h-4 w-4"
                    aria-hidden
                  />
                </span>
                <span className="flex-1">
                  <span className="block text-base font-semibold">
                    Settings
                  </span>
                  <span className="text-muted-foreground block text-sm font-normal">
                    Manage server connection, microphone and robot controls.
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={mcp.statusTone}>{mcp.statusLabel}</Badge>
                  <Badge tone="muted">{robotLanguageLabel(language)}</Badge>
                </span>
              </span>
            </AccordionTrigger>
          </div>
          <Button size="sm" variant="ghost" onClick={onRecalibrate}>
            Recalibrate
          </Button>
        </div>

        <AccordionContent className="px-6 pb-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <McpSettingsCard mcp={mcp} />
            <MicSettingsCard
              language={language}
              onLanguageChange={onLanguageChange}
              isListening={isListening}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function McpSettingsCard({ mcp }: { mcp: RoboticsMcp }) {
  return (
    <section
      aria-labelledby="robotics-tools-heading"
      className="glass-card relative overflow-hidden rounded-xl p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id="robotics-tools-heading" className="text-sm font-semibold">
            Tool Settings
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Manage MCP server connection.
          </p>
        </div>
        <Badge tone={mcp.statusTone}>{mcp.statusLabel}</Badge>
      </div>
      <p role="status" className="text-muted-foreground mt-2 text-xs">
        {mcp.statusMessage}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={mcp.status === 'connected' ? 'secondary' : 'default'}
          disabled={mcp.status === 'connecting'}
          onClick={mcp.connect}
        >
          {mcp.status === 'connected' ? 'Reconnect' : 'Connect'}
        </Button>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <Label htmlFor="robotics-use-tools" className="text-muted-foreground">
            Use Tools
          </Label>
          <Switch
            id="robotics-use-tools"
            checked={mcp.useMcp}
            onCheckedChange={mcp.setUseMcp}
          />
        </div>
      </div>

      {mcp.status === 'connected' && (
        <div className="mt-4 space-y-1.5">
          {mcp.availableTools.length > 0 ? (
            <>
              <Label htmlFor="mcp-tool-select" className="text-xs">
                Available Tools
              </Label>
              <Select
                value={mcp.selectedToolId || ALL_TOOLS}
                onValueChange={(value) =>
                  mcp.setSelectedToolId(value === ALL_TOOLS ? '' : value)
                }
              >
                <SelectTrigger id="mcp-tool-select" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TOOLS}>
                    Use all available tools
                  </SelectItem>
                  {mcp.availableTools.map((tool) => (
                    <SelectItem key={tool.id} value={tool.id}>
                      {tool.server
                        ? `${tool.server} • ${tool.name}`
                        : tool.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mcp.selectedTool?.description && (
                <p className="text-muted-foreground text-xs">
                  {mcp.selectedTool.description}
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground bg-muted rounded-lg px-3 py-3 text-xs">
              No tools available for the connected MCP server.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function MicSettingsCard({
  language,
  onLanguageChange,
  isListening,
}: {
  language: RobotLanguage
  onLanguageChange: (language: RobotLanguage) => void
  isListening: boolean
}) {
  return (
    <section
      aria-labelledby="robotics-mic-heading"
      className="glass-card relative overflow-hidden rounded-xl p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id="robotics-mic-heading" className="text-sm font-semibold">
            Microphone
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Speech-to-text transcription options.
          </p>
        </div>
        <Badge tone={isListening ? 'success' : 'muted'}>
          {isListening ? 'Listening' : 'Idle'}
        </Badge>
      </div>
      <div className="mt-3 space-y-1.5">
        <Label htmlFor="mic-language-select" className="text-xs">
          Transcription language
        </Label>
        <Select
          value={language}
          onValueChange={(value) => {
            if (isRobotLanguage(value)) onLanguageChange(value)
          }}
          disabled={isListening}
        >
          <SelectTrigger id="mic-language-select" className="w-full sm:w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROBOT_LANGUAGES.map((option) => (
              <SelectItem key={option.code} value={option.code}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  )
}
