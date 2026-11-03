// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Video } from 'lucide-react'
import type { VoiceInputControls } from '@/context/voice-input-context'
import type { RoboticsChat as RoboticsChatState } from '../hooks/use-robotics-chat'
import type { RoboticsMcp } from '../hooks/use-robotics-mcp'
import type { RobotLanguage } from '../lib/languages'
import { AppSettings } from './app-settings'
import { LiveCamera } from './live-camera'
import { RoboticsChat } from './robotics-chat'

/** Wizard step 4: the live camera and the agent chat that drives the robot. */
export function AppStep({
  workerBaseUrl,
  mcp,
  chat,
  mic,
  language,
  onLanguageChange,
  onBackToCalibration,
}: {
  workerBaseUrl: string
  mcp: RoboticsMcp
  chat: RoboticsChatState
  mic: VoiceInputControls
  language: RobotLanguage
  onLanguageChange: (language: RobotLanguage) => void
  onBackToCalibration: () => void
}) {
  return (
    <div className="space-y-6">
      <AppSettings
        mcp={mcp}
        language={language}
        onLanguageChange={onLanguageChange}
        isListening={mic.isRecording}
        onRecalibrate={onBackToCalibration}
      />

      <div className="grid grid-cols-1 gap-6 xl:h-[600px] xl:grid-cols-2">
        <section
          aria-labelledby="robotics-camera-heading"
          className="glass-card relative flex h-full flex-col overflow-hidden rounded-xl"
        >
          <div className="border-border border-b px-5 py-4">
            <h3
              id="robotics-camera-heading"
              className="text-foreground flex items-center gap-2 text-base font-semibold"
            >
              <Video className="h-5 w-5" aria-hidden /> Live Camera Stream
            </h3>
          </div>
          <div className="flex min-h-0 flex-1 items-center p-5">
            <LiveCamera workerBaseUrl={workerBaseUrl} className="w-full" />
          </div>
        </section>

        <RoboticsChat
          chat={chat}
          mic={mic}
          sendOptions={{
            toolId: mcp.selectedToolId,
            language,
            useMcp: mcp.useMcp,
          }}
        />
      </div>
    </div>
  )
}
