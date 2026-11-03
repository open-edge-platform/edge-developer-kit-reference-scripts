// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ImageIcon, Type } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { EmbeddingCapabilities } from '../config'

function capabilityText(capabilities: EmbeddingCapabilities): string {
  if (capabilities.image) {
    return 'This model places text and images in one space: compare a text with other texts, or an image with text descriptions.'
  }
  return capabilities.source === 'oep'
    ? 'This model embeds text only: compare a text with other texts. To compare images, choose a CLIP or SigLIP model in Configure.'
    : 'This model embeds text only: compare a text with other texts. To compare images, switch the engine to Open Edge Platform with a CLIP or SigLIP model in Configure.'
}

/** Which engine answers and whether the model also embeds images, stated in words. */
export function EngineBadge({
  capabilities,
}: {
  capabilities: EmbeddingCapabilities
}) {
  const isOep = capabilities.source === 'oep'
  const Icon = capabilities.image ? ImageIcon : Type
  return (
    <div className="space-y-1.5" data-testid="embeddings-capabilities">
      <Badge
        variant={isOep ? 'default' : 'secondary'}
        className="gap-1.5 text-xs"
        data-testid="embeddings-engine-badge"
      >
        <Icon aria-hidden className="h-3.5 w-3.5" />
        {isOep
          ? capabilities.image
            ? 'Open Edge Platform · text + image'
            : 'Open Edge Platform · text only'
          : 'Multiserve · text only'}
      </Badge>
      <p className="text-muted-foreground text-xs">
        {capabilityText(capabilities)}
      </p>
    </div>
  )
}
