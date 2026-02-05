// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge as BadgeComponent } from '@/components/ui/badge'
import { Workload } from '@/payload-types'

interface CurrentSelectionBadgeProps {
  label: string
  modelName: string
  modelType: 'verified' | 'custom'
  engine: Workload['engine']
}

export function CurrentSelectionBadge({
  label,
  modelName,
  modelType,
  engine,
}: CurrentSelectionBadgeProps) {
  return (
    <div className="text-muted-foreground flex items-center gap-2">
      <span className="font-medium">{label}:</span>
      <span className="text-foreground font-medium">{modelName}</span>
      <BadgeComponent variant={'secondary'} className="text-xs">
        {engine}
      </BadgeComponent>
      <BadgeComponent
        variant={modelType === 'verified' ? 'default' : 'secondary'}
        className="text-xs"
      >
        {modelType === 'verified' ? '✓ Verified' : 'Custom'}
      </BadgeComponent>
    </div>
  )
}

interface ModelSelectorProps {
  tabValue: string
  onTabChange: (value: string) => void
  savedModelType?: 'verified' | 'custom'
  verifiedElement: React.ReactNode
  customElement?: React.ReactNode
}

export function ModelSelector({
  tabValue,
  onTabChange,
  savedModelType,
  verifiedElement,
  customElement,
}: ModelSelectorProps) {
  return (
    <Tabs value={tabValue} onValueChange={onTabChange} className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="predefined" className="relative">
          Verified Models
          {savedModelType === 'verified' && (
            <span className="ml-1 flex h-2 w-2">
              <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="custom" className="relative">
          Custom Model
          {savedModelType === 'custom' && (
            <span className="ml-1 flex h-2 w-2">
              <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500"></span>
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="predefined" className="mt-4 space-y-4">
        {verifiedElement}
      </TabsContent>

      <TabsContent value="custom" className="mt-4 space-y-4">
        {customElement}
      </TabsContent>
    </Tabs>
  )
}
