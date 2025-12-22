// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Plus, Trash2, Edit, Loader2, Webhook, Send } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  useSubscribeWebhook,
  useUpdateWebhookSubscriber,
  useUnsubscribeWebhook,
  useTestWebhook,
} from '@/hooks/use-wake-word-detection'
import AddSubscriberDialog, { Subscriber } from './add-subscriber-dialog'
import { FRONTEND_PORT } from '@/lib/constants'

interface WebhookSubscribersProps {
  disabled?: boolean
  subscribers: Subscriber[]
  isLoading: boolean
  onAddLocalSubscriber: () => void
  onRefreshSubscribers: () => void
}

export default function WebhookSubscribers({
  disabled,
  subscribers,
  isLoading,
  onAddLocalSubscriber,
  onRefreshSubscribers,
}: WebhookSubscribersProps) {
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingSubscriber, setEditingSubscriber] = useState<
    Subscriber | undefined
  >()

  const subscribeWebhook = useSubscribeWebhook()
  const updateSubscriber = useUpdateWebhookSubscriber()
  const unsubscribeWebhook = useUnsubscribeWebhook()
  const testWebhook = useTestWebhook()

  const handleAddSubscriber = async (
    subscriberData: Omit<Subscriber, 'id'>,
  ) => {
    try {
      await subscribeWebhook.mutateAsync(subscriberData)
      toast.success('Webhook subscriber added successfully')
      onRefreshSubscribers()
    } catch (error) {
      console.error('Error adding subscriber:', error)
      toast.error('Failed to add webhook subscriber')
      throw error
    }
  }

  const handleEditSubscriber = async (
    subscriberData: Omit<Subscriber, 'id'>,
  ) => {
    if (!editingSubscriber) return

    try {
      await updateSubscriber.mutateAsync({
        ...subscriberData,
      })
      toast.success('Webhook subscriber updated successfully')
      setEditingSubscriber(undefined)
      onRefreshSubscribers()
    } catch (error) {
      console.error('Error updating subscriber:', error)
      toast.error('Failed to update webhook subscriber')
      throw error
    }
  }

  const handleDeleteSubscriber = async (url: string) => {
    try {
      await unsubscribeWebhook.mutateAsync(url)
      toast.success('Webhook subscriber deleted successfully')
      onRefreshSubscribers()
    } catch (error) {
      console.error('Error deleting subscriber:', error)
      toast.error('Failed to delete webhook subscriber')
    }
  }

  const handleAddLocalSubscriber = async () => {
    try {
      await subscribeWebhook.mutateAsync({
        name: 'Local',
        url: `http://localhost:${FRONTEND_PORT}/api/wake-word-detected`,
        threshold: 0.5,
      })
      toast.success('Local webhook subscriber added')
      onRefreshSubscribers()
      onAddLocalSubscriber()
    } catch (error) {
      console.error('Error adding local subscriber:', error)
      toast.error('Failed to add local webhook subscriber')
    }
  }

  const handleTestWebhook = async () => {
    try {
      const result = await testWebhook.mutateAsync()
      const results = result.results as Array<{
        url: string
        status: string
        message: string
      }>

      const successCount = results.filter((r) => r.status === 'success').length
      const failCount = results.filter((r) => r.status === 'error').length

      if (failCount === 0) {
        toast.success(
          `Test webhooks sent successfully to ${successCount} subscriber(s)`,
        )
      } else {
        toast.warning(
          `Sent to ${successCount} subscriber(s), ${failCount} failed`,
        )
      }
    } catch (error) {
      console.error('Error testing webhooks:', error)
      toast.error('Failed to send test webhooks')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              <h3 className="text-lg font-semibold">Webhook Subscribers</h3>
            </div>
            <CardDescription className="text-muted-foreground text-sm font-normal">
              Manage webhook endpoints that receive wake word detection events
            </CardDescription>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleTestWebhook}
              className="flex items-center gap-2"
              disabled={
                disabled || subscribers.length === 0 || testWebhook.isPending
              }
              variant="outline"
            >
              {testWebhook.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Test Webhook
            </Button>

            <Button
              onClick={() => setShowAddDialog(true)}
              className="flex items-center gap-2"
              disabled={disabled}
            >
              <Plus className="h-4 w-4" />
              Add Subscriber
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {disabled ? (
          <div className="border-muted rounded-lg border-2 border-dashed p-8 text-center">
            <div className="bg-muted mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
              <Webhook className="text-muted-foreground h-6 w-6" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">
              Service is currently offline
            </h3>
            <p className="text-muted-foreground mx-auto mb-4 max-w-sm">
              Please start the wake word detection service to manage webhook
              subscribers.
            </p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="m-auto h-8 w-8 animate-spin" />
            </div>
          </div>
        ) : subscribers.length === 0 ? (
          <div className="border-muted rounded-lg border-2 border-dashed p-8 text-center">
            <div className="bg-muted mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
              <Webhook className="text-muted-foreground h-6 w-6" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">
              No webhook subscribers
            </h3>
            <p className="text-muted-foreground mx-auto mb-4 max-w-sm">
              Add a webhook endpoint to receive real-time wake word detection
              notifications.
            </p>
            <Button onClick={() => setShowAddDialog(true)} disabled={disabled}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Subscriber
            </Button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background text-muted-foreground px-2">
                  Quick Start
                </span>
              </div>
            </div>

            <p className="text-muted-foreground mb-3 text-sm">
              Try it out with a local endpoint to see detection events in
              real-time
            </p>
            <Button
              onClick={handleAddLocalSubscriber}
              disabled={disabled}
              variant="outline"
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Local Subscriber
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Webhook URL</TableHead>
                  <TableHead>Threshold</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscribers.map((subscriber) => (
                  <TableRow key={subscriber.url}>
                    <TableCell className="font-medium">
                      {subscriber.name || 'Unnamed'}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {subscriber.url}
                    </TableCell>
                    <TableCell>
                      {subscriber.threshold?.toFixed(2) || '0.50'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingSubscriber(subscriber)
                            setShowAddDialog(true)
                          }}
                          disabled={disabled}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteSubscriber(subscriber.url)}
                          disabled={disabled}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <AddSubscriberDialog
          open={showAddDialog}
          onOpenChange={(open) => {
            setShowAddDialog(open)
            if (!open) {
              setEditingSubscriber(undefined)
            }
          }}
          onSave={
            editingSubscriber ? handleEditSubscriber : handleAddSubscriber
          }
          editingSubscriber={editingSubscriber}
        />
      </CardContent>
    </Card>
  )
}
