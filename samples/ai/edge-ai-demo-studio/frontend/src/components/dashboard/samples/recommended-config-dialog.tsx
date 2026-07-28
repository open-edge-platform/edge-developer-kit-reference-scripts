// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertTriangle, Cpu, Loader2, RotateCcw, Wand2 } from 'lucide-react'
import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useGetService } from '@/context/service-status-context'
import { useSystemInfo } from '@/context/system-info-context'
import { cn } from '@/lib/utils'
import { resolveRecommendedConfigs } from '@/samples/types'
import type { ResolvedRecommendation, Sample } from '@/samples/types'
import { getServiceById } from '@/services/registry'
import { useApplyRecommendedConfig } from './use-apply-recommended-config'

interface RecommendedConfigDialogProps {
  sample: Sample
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RecommendedConfigDialog({
  sample,
  open,
  onOpenChange,
}: RecommendedConfigDialogProps) {
  const { systemInfo } = useSystemInfo()
  const { mutate: applyConfig, isPending } = useApplyRecommendedConfig()

  const configs = useMemo(
    () => resolveRecommendedConfigs(sample, systemInfo?.devices),
    [sample, systemInfo?.devices],
  )

  function handleApply() {
    applyConfig(configs, {
      onSuccess: () => onOpenChange(false),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        {/* Gradient header strip */}
        <div className="from-primary/10 via-secondary/5 relative bg-gradient-to-br to-transparent px-6 pt-6 pb-5">
          <div className="sidebar-brand-stripe absolute inset-x-0 top-0 h-0.5" />
          <DialogHeader className="space-y-2">
            <DialogTitle className="flex items-center gap-2.5 text-base">
              <span className="bg-primary/10 ring-primary/15 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1">
                <Wand2 className="text-primary h-5 w-5" />
              </span>
              <span className="truncate">Use Recommended Config</span>
            </DialogTitle>
            <DialogDescription className="leading-relaxed">
              Apply the suggested device and model settings for each service.
              Running services will restart automatically to pick up the new
              config.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pt-1 pb-5">
          <ScrollArea className="h-72">
            <div className="space-y-2 py-2">
              {configs.map((cfg) => (
                <ServiceConfigRow key={cfg.serviceId} cfg={cfg} />
              ))}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="border-border/60 bg-muted/20 border-t px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={isPending} className="gap-2">
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Applying…
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" />
                Apply &amp; save
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ServiceConfigRow({ cfg }: { cfg: ResolvedRecommendation }) {
  const service = useGetService(cfg.serviceId)
  const staticService = getServiceById(cfg.serviceId)
  const name = staticService?.name ?? cfg.serviceId
  const isRunning = service?.status === 'online'
  const isDifferent =
    service &&
    ((cfg.device && cfg.device !== service.currentDevice) ||
      (cfg.model && cfg.model !== service.currentModel) ||
      (cfg.backend && cfg.backend !== service.currentBackend) ||
      (cfg.quant && cfg.quant !== service.currentQuant))

  return (
    <div className="border-border/50 bg-background/60 rounded-xl border p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                service?.status === 'online' && 'bg-success',
                service?.status === 'error' && 'bg-destructive',
                (!service || service.status === 'offline') &&
                  'bg-muted-foreground/50',
                service?.status === 'starting' && 'bg-info animate-pulse',
              )}
            />
            <span className="text-foreground text-sm font-medium">{name}</span>
            {isRunning && isDifferent && (
              <span className="text-info flex items-center gap-1 text-[11px]">
                <RotateCcw className="h-3 w-3" />
                will restart
              </span>
            )}
          </div>

          {cfg.device && (
            <div className="flex items-center gap-1.5">
              <Cpu className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
              <span className="text-foreground/90 font-mono text-xs">
                {cfg.device}
              </span>
              {cfg.fellBack && cfg.fallbackNote && (
                <span className="text-warning flex items-center gap-1 text-[11px]">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {cfg.fallbackNote}
                </span>
              )}
            </div>
          )}
        </div>

        {(cfg.backend || cfg.quant) && (
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {cfg.backend && (
              <Badge variant="outline" className="text-[10px]">
                {cfg.backend}
              </Badge>
            )}
            {cfg.quant && (
              <Badge variant="outline" className="text-[10px]">
                {cfg.quant}
              </Badge>
            )}
          </div>
        )}
      </div>

      {cfg.model && (
        <p className="text-muted-foreground mt-2 truncate text-[11px]">
          {cfg.model}
        </p>
      )}
    </div>
  )
}
