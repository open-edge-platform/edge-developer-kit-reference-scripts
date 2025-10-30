// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Settings, Database, ExternalLink, Info } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useGetKnowledgeBases } from '@/hooks/use-embedding'
import { KnowledgeBase } from '@/types/embedding'
import { useGetWorkloadByType } from '@/hooks/use-workload'

interface DigitalAvatarSettingsProps {
  isOpen: boolean
  onClose: () => void
  useEmbedding: boolean
  selectedKnowledgeBase: KnowledgeBase | null
  onSettingsUpdate: (settings: {
    useEmbedding: boolean
    selectedKnowledgeBase: KnowledgeBase | null
  }) => void
}

export function DigitalAvatarSettings({
  isOpen,
  onClose,
  useEmbedding,
  selectedKnowledgeBase,
  onSettingsUpdate,
}: DigitalAvatarSettingsProps) {
  const { data: embeddingService } = useGetWorkloadByType('embedding')
  const [localUseEmbedding, setLocalUseEmbedding] = useState(useEmbedding)
  const [localSelectedKnowledgeBase, setLocalSelectedKnowledgeBase] =
    useState<KnowledgeBase | null>(selectedKnowledgeBase)

  const { data: knowledgeBases, isLoading: isLoadingKnowledgeBases } =
    useGetKnowledgeBases({
      disabled: !localUseEmbedding,
    })

  useEffect(() => {
    setLocalUseEmbedding(useEmbedding)
    setLocalSelectedKnowledgeBase(selectedKnowledgeBase)
  }, [useEmbedding, selectedKnowledgeBase, isOpen])

  const handleApplySettings = () => {
    onSettingsUpdate({
      useEmbedding: localUseEmbedding,
      selectedKnowledgeBase: localSelectedKnowledgeBase,
    })
    onClose()
  }

  const handleEmbeddingToggle = (checked: boolean) => {
    setLocalUseEmbedding(checked)
    if (!checked) {
      setLocalSelectedKnowledgeBase(null)
    }
  }

  const handleKnowledgeBaseChange = (value: string) => {
    const kbId = parseInt(value)
    setLocalSelectedKnowledgeBase(
      knowledgeBases?.find((kb) => kb.id === kbId) || null,
    )
  }

  const isEmbeddingServiceActive = embeddingService?.status === 'active'

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Digital Avatar Settings
          </DialogTitle>
          <DialogDescription>
            Configure embedding and knowledge base settings for enhanced
            conversations
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Embedding Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-sm font-medium">Enable Embedding</Label>
                <p className="text-muted-foreground text-xs">
                  Use knowledge bases to enhance avatar responses
                </p>
              </div>
              <Switch
                checked={localUseEmbedding}
                onCheckedChange={handleEmbeddingToggle}
                disabled={!isEmbeddingServiceActive}
              />
            </div>

            {!isEmbeddingServiceActive && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  The embedding service is not active. Please start the
                  embedding service in the{' '}
                  <Button
                    variant="link"
                    className="h-auto p-0 text-sm"
                    onClick={() => window.open('/embedding', '_blank')}
                  >
                    Embedding page
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </Button>{' '}
                  before enabling embedding functionality.
                </AlertDescription>
              </Alert>
            )}

            {localUseEmbedding && isEmbeddingServiceActive && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  When enabled, the avatar will use the selected knowledge base
                  to provide more informed responses based on your documents.
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Knowledge Base Selection */}
          {localUseEmbedding && isEmbeddingServiceActive && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Knowledge Base</Label>
                <p className="text-muted-foreground text-xs">
                  Select which knowledge base to use for enhanced responses
                </p>
              </div>

              {isLoadingKnowledgeBases ? (
                <div className="text-muted-foreground text-sm">
                  Loading knowledge bases...
                </div>
              ) : !knowledgeBases || knowledgeBases.length === 0 ? (
                <Alert>
                  <Database className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    No knowledge bases found. Create one in the{' '}
                    <Button
                      variant="link"
                      className="h-auto p-0 text-sm"
                      onClick={() => window.open('/embedding', '_blank')}
                    >
                      Embedding service
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </Button>
                    .
                  </AlertDescription>
                </Alert>
              ) : (
                <Select
                  value={
                    localSelectedKnowledgeBase?.id?.toString() || 'no-selection'
                  }
                  onValueChange={handleKnowledgeBaseChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a knowledge base">
                      {localSelectedKnowledgeBase
                        ? knowledgeBases.find(
                            (kb: KnowledgeBase) =>
                              kb.id === localSelectedKnowledgeBase.id,
                          )?.name || 'Unknown'
                        : 'Select a knowledge base'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no-selection" disabled>
                      Select a knowledge base
                    </SelectItem>
                    {knowledgeBases.map((kb: KnowledgeBase) => (
                      <SelectItem key={kb.id} value={kb.id!.toString()}>
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4" />
                          <span>{kb.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  To modify knowledge bases, add documents, or create new ones,
                  visit the{' '}
                  <Button
                    variant="link"
                    className="h-auto p-0 text-sm"
                    onClick={() => window.open('/embedding', '_blank')}
                  >
                    Embedding Service
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleApplySettings}>Apply Settings</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
