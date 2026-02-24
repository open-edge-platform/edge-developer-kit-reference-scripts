// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Brain, AlertCircle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { LipsyncSettings } from '@/types/workload'
import { DeviceSelector } from '../../common/device-selector'
import {
  ModelSource,
  ModelSourceSelector,
} from '../../common/model-source-selector'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  updateSettings: (settings: LipsyncSettings) => Promise<unknown>
  currentSettings: LipsyncSettings
}

export function SettingsModal({
  isOpen,
  onClose,
  currentSettings: { model: selectedModel, turnServerIp },
  updateSettings,
}: SettingsModalProps) {
  const [tempDevice, setTempDevice] = useState(selectedModel.device || 'cpu')
  const [tempTurnServerIp, setTempTurnServerIp] = useState(turnServerIp || '')
  const [validationError, setValidationError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [tempSource, setTempSource] = useState<ModelSource>(
    (selectedModel.source as ModelSource) || 'huggingface',
  )

  // Validation function for TURN server IP and port
  const validateTurnServerIp = (value: string): string => {
    // If empty, it's valid since the field is optional
    if (!value.trim()) {
      return ''
    }

    // Check if it includes a port (IP:PORT format)
    const ipPortRegex = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$/
    const ipOnlyRegex = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/
    const hostnamePortRegex = /^([a-zA-Z0-9.-]+):(\d{1,5})$/
    const hostnameOnlyRegex = /^([a-zA-Z0-9.-]+)$/

    let isValid = false
    let errorMessage = ''

    if (ipPortRegex.test(value)) {
      const [, ip, port] = value.match(ipPortRegex) || []
      const portNum = parseInt(port)

      // Validate IP octets
      const octets = ip.split('.').map(Number)
      const validOctets = octets.every((octet) => octet >= 0 && octet <= 255)

      // Validate port range
      const validPort = portNum >= 1 && portNum <= 65535

      if (validOctets && validPort) {
        isValid = true
      } else if (!validOctets) {
        errorMessage = 'Invalid IP address format'
      } else if (!validPort) {
        errorMessage = 'Port must be between 1 and 65535'
      }
    } else if (ipOnlyRegex.test(value)) {
      const octets = value.split('.').map(Number)
      const validOctets = octets.every((octet) => octet >= 0 && octet <= 255)

      if (validOctets) {
        errorMessage = 'Port number is required (use format IP:PORT)'
      } else {
        errorMessage = 'Invalid IP address format'
      }
    } else if (hostnamePortRegex.test(value)) {
      const [, , port] = value.match(hostnamePortRegex) || []
      const portNum = parseInt(port)

      if (portNum >= 1 && portNum <= 65535) {
        isValid = true
      } else {
        errorMessage = 'Port must be between 1 and 65535'
      }
    } else if (hostnameOnlyRegex.test(value)) {
      errorMessage = 'Port number is required (use format HOSTNAME:PORT)'
    } else {
      errorMessage =
        'Invalid format. Use IP:PORT (e.g., 192.168.1.100:3478) or HOSTNAME:PORT (e.g., turn.example.com:3478)'
    }

    return isValid ? '' : errorMessage
  }

  const handleDeviceSelect = (value: string) => {
    setTempDevice(value)
  }

  const handleTurnServerIpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setTempTurnServerIp(value)

    // Clear validation error when user starts typing
    if (validationError) {
      setValidationError('')
    }
  }

  const handleSave = () => {
    // Validate TURN server IP if provided (field is optional)
    const error = validateTurnServerIp(tempTurnServerIp.trim())
    if (error) {
      setValidationError(error)
      return
    }

    setValidationError('')
    setIsLoading(true)
    updateSettings({
      model: {
        name: selectedModel.name,
        device: tempDevice,
        source: tempSource,
      },
      turnServerIp: tempTurnServerIp.trim(),
    })
      .then(() => {
        setIsLoading(false)
        onClose()
      })
      .catch(() => {
        setIsLoading(false)
      })
  }

  const [prevDeps, setPrevDeps] = useState({
    model: selectedModel,
    turnServerIp: turnServerIp,
  })

  if (
    selectedModel !== prevDeps.model ||
    turnServerIp !== prevDeps.turnServerIp
  ) {
    setPrevDeps({ model: selectedModel, turnServerIp: turnServerIp })
    setTempDevice(selectedModel.device || 'cpu')
    setTempSource(selectedModel.source || 'huggingface')
    setTempTurnServerIp(turnServerIp || '')
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <Brain className="h-5 w-5" />
            Lipsync Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <ModelSourceSelector value={tempSource} onChange={setTempSource} />
          <DeviceSelector
            value={tempDevice}
            onChange={handleDeviceSelect}
            accelerator="pytorch"
          />
          <div className="space-y-2">
            <Label htmlFor="turn-server-ip" className="text-base font-medium">
              STUN/TURN Server IP
            </Label>
            <p className="text-sm text-gray-500">
              Enter STUN/TURN server IP address with port for remote access
              (optional, e.g., 192.168.1.100:3478 or turn.example.com:3478)
            </p>
            <Input
              id="turn-server-ip"
              type="text"
              placeholder="Optional: 192.168.1.100:3478 or turn.example.com:3478"
              value={tempTurnServerIp}
              onChange={handleTurnServerIpChange}
              className={`mt-2 ${
                validationError ? 'border-red-500 focus:border-red-500' : ''
              }`}
            />
            {validationError && (
              <div className="mt-1 flex items-center gap-2 text-sm text-red-600">
                <AlertCircle className="h-4 w-4" />
                <span>{validationError}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end space-x-2 border-t pt-4">
          <Button
            variant="outline"
            disabled={isLoading}
            onClick={onClose}
            className="bg-white text-gray-700"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isLoading || !!validationError}
            className="bg-blue-600 text-white"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Save Settings'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
