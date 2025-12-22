// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

export interface Subscriber {
  id?: number
  url: string
  name?: string
  threshold?: number
  apiKey?: string
}

interface AddSubscriberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (subscriber: Omit<Subscriber, 'id'>) => Promise<void>
  editingSubscriber?: Subscriber
}

export default function AddSubscriberDialog({
  open,
  onOpenChange,
  onSave,
  editingSubscriber,
}: AddSubscriberDialogProps) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [threshold, setThreshold] = useState(0.5)
  const [apiKey, setApiKey] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (editingSubscriber) {
      setName(editingSubscriber.name || '')
      setUrl(editingSubscriber.url)
      setThreshold(editingSubscriber.threshold || 0.5)
      setApiKey(editingSubscriber.apiKey || '')
    } else {
      setName('')
      setUrl('')
      setThreshold(0.5)
      setApiKey('')
    }
  }, [editingSubscriber, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      await onSave({
        url,
        name: name || undefined,
        threshold,
        apiKey: apiKey || undefined,
      })
      onOpenChange(false)
    } catch (error) {
      console.error('Error saving subscriber:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {editingSubscriber ? 'Edit Subscriber' : 'Add Webhook Subscriber'}
            </DialogTitle>
            <DialogDescription>
              Configure a webhook URL to receive wake word detection events
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name (Optional)</Label>
              <Input
                id="name"
                placeholder="My Wake Word Service"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="url">
                Webhook URL <span className="text-red-500">*</span>
              </Label>
              <Input
                id="url"
                type="url"
                placeholder="http://localhost:8000/webhook"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                disabled={!!editingSubscriber}
              />
              {editingSubscriber && (
                <p className="text-muted-foreground text-xs">
                  URL cannot be changed when editing
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="api_key">API Key (Optional)</Label>
              <Input
                id="api_key"
                type="password"
                placeholder="Bearer token for authentication"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                If provided, will be sent as Authorization header
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="threshold">Detection Threshold</Label>
              <p className="text-muted-foreground text-sm">
                Minimum confidence score for detection (0.0 to 1.0)
              </p>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    Current: {threshold.toFixed(2)}
                  </span>
                </div>
                <Slider
                  id="threshold"
                  value={[threshold]}
                  onValueChange={(values) => setThreshold(values[0])}
                  min={0}
                  max={1}
                  step={0.05}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>0.0 (More sensitive)</span>
                  <span>1.0 (Less sensitive)</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>{editingSubscriber ? 'Update' : 'Add'} Subscriber</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
