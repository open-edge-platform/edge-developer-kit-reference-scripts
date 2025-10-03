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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Brain, AlertCircle, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePytorchAccelerator } from '@/hooks/use-accelerators'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  updateSettings: (device: string, turnServerIp: string) => Promise<unknown>
  selectedDevice: string
  turnServerIp: string
}

export function SettingsModal({
  isOpen,
  onClose,
  selectedDevice,
  turnServerIp,
  updateSettings,
}: SettingsModalProps) {
  const [tempDevice, setTempDevice] = useState(selectedDevice || 'cpu')
  const [tempTurnServerIp, setTempTurnServerIp] = useState('')
  const [validationError, setValidationError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { data: devices } = usePytorchAccelerator()

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
    updateSettings(tempDevice, tempTurnServerIp.trim())
      .then(() => {
        setIsLoading(false)
        onClose()
      })
      .catch(() => {
        setIsLoading(false)
      })
  }

  useEffect(() => {
    setTempDevice(selectedDevice || 'cpu')
    setTempTurnServerIp(turnServerIp || '')
  }, [selectedDevice, turnServerIp])

  const DeviceSelector = () => {
    return (
      <div>
        <Label htmlFor="model-select" className="text-base font-medium">
          Device
        </Label>
        <Select value={tempDevice} onValueChange={handleDeviceSelect}>
          <SelectTrigger className="mt-2 w-full">
            <SelectValue placeholder="Choose a device" />
          </SelectTrigger>
          <SelectContent>
            {(devices ?? []).map((device) => (
              <SelectItem key={device.id} value={device.id}>
                <div className="flex flex-col">
                  <span className="font-medium">{device.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
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
          <DeviceSelector />
          <div className="space-y-2">
            <Label htmlFor="turn-server-ip" className="text-base font-medium">
              TURN Server IP
            </Label>
            <p className="text-sm text-gray-500">
              Enter TURN server IP address with port for remote access
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
