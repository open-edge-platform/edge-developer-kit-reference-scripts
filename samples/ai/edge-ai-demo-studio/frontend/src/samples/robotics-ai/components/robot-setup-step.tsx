// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, Usb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { RoboticsSetup } from '../hooks/use-robotics-setup'

/** The port select's value for "let the worker find the port". */
const AUTO_DETECT_PORT = 'auto'

/** Wizard step 2: choose the arm type and serial port, and connect it. */
export function RobotSetupStep({
  setup,
  onContinue,
}: {
  setup: RoboticsSetup
  onContinue: () => void
}) {
  return (
    <div className="glass-card relative overflow-hidden rounded-xl">
      <div className="from-primary/[0.04] via-secondary/[0.02] pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent" />
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center sm:py-20">
        <div className="mb-6">
          <div className="bg-primary/10 ring-primary/20 flex h-20 w-20 items-center justify-center rounded-2xl ring-1">
            <Usb className="text-primary h-9 w-9" aria-hidden />
          </div>
        </div>

        <h3 className="text-foreground text-xl font-semibold tracking-tight">
          Connect Robot Arm
        </h3>
        <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-relaxed">
          Select the arm type and serial port, then connect.
        </p>

        <div className="mt-8 w-full max-w-sm space-y-4 text-left">
          <div className="space-y-1">
            <Label htmlFor="setup-robot-type">Robot Type</Label>
            <Select
              value={setup.type || undefined}
              onValueChange={setup.setType}
            >
              <SelectTrigger id="setup-robot-type" className="w-full">
                <SelectValue placeholder="Select a robot type" />
              </SelectTrigger>
              <SelectContent>
                {setup.availableTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {setup.type === 'SO-ARM101' && (
            <div className="space-y-1">
              <Label htmlFor="setup-robot-port">Robot Port</Label>
              {setup.availablePorts.length > 0 ? (
                <Select
                  value={setup.port || AUTO_DETECT_PORT}
                  onValueChange={(value) =>
                    setup.setPort(value === AUTO_DETECT_PORT ? '' : value)
                  }
                >
                  <SelectTrigger
                    id="setup-robot-port"
                    className="w-full"
                    aria-describedby="setup-robot-port-hint"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO_DETECT_PORT}>
                      Auto-detect (default)
                    </SelectItem>
                    {setup.availablePorts.map((port) => (
                      <SelectItem key={port.device} value={port.device}>
                        {port.device}
                        {port.description ? ` — ${port.description}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="setup-robot-port"
                  placeholder="/dev/ttyACM0"
                  value={setup.port}
                  onChange={(e) => setup.setPort(e.target.value)}
                  aria-describedby="setup-robot-port-hint"
                />
              )}
              <p
                id="setup-robot-port-hint"
                className="text-muted-foreground text-xs"
              >
                Select the serial port your robot arm is connected to.
              </p>
            </div>
          )}
          {setup.connectError && (
            <p role="alert" className="text-destructive text-sm">
              {setup.connectError}
            </p>
          )}
          <Button
            size="lg"
            className="shadow-primary/10 w-full shadow-lg"
            disabled={!setup.type || setup.isConnecting}
            aria-busy={setup.isConnecting || undefined}
            onClick={() => setup.connectRobot(onContinue)}
          >
            {setup.isConnecting && (
              <Loader className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            )}
            Connect
          </Button>
        </div>
      </div>
    </div>
  )
}
