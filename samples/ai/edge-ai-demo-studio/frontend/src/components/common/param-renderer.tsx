// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
  RefreshCw,
  RotateCcw,
  Wrench,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { cn, getFirstSentence } from '@/lib/utils'
import type { DemoParam } from '@/types/demo-params'
import { Button } from '@/components/ui/button'

function ParamTooltip({ tooltip }: { tooltip?: string }) {
  if (!tooltip) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="hover:bg-muted/20 flex h-5 w-5 items-center justify-center rounded"
        >
          <Info className="text-muted-foreground h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export function ParamRenderer({ param }: { param: DemoParam }) {
  if (param.type === 'info-list') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-muted-foreground text-xs">{param.label}</Label>
          {param.items.length > 0 && (
            <Badge
              variant="secondary"
              className="h-4 px-1.5 text-[10px] font-normal tabular-nums"
            >
              {param.items.length}
            </Badge>
          )}
        </div>
        {param.items.length === 0 ? (
          <p className="text-muted-foreground text-[11px] italic">
            {param.emptyText ?? 'None available'}
          </p>
        ) : (
          <div className="space-y-0.5">
            {param.items.map((item) => {
              const summary = item.description
                ? getFirstSentence(item.description)
                : undefined
              return (
                <TooltipProvider key={item.name}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="hover:bg-muted group flex items-center gap-1.5 rounded-md px-2 py-1">
                        <Wrench className="text-muted-foreground h-3 w-3 shrink-0" />
                        <span className="text-foreground truncate text-xs leading-none font-medium">
                          {item.name}
                        </span>
                        {summary && (
                          <span className="text-muted-foreground ml-auto hidden truncate text-[10px] leading-none group-hover:inline">
                            {summary}
                          </span>
                        )}
                      </div>
                    </TooltipTrigger>
                    {item.description && (
                      <TooltipContent side="left" className="max-w-xs text-xs">
                        <p className="font-medium">{item.name}</p>
                        <p className="text-muted-foreground mt-1 whitespace-pre-line">
                          {item.description}
                        </p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (param.type === 'slider') {
    const isUnset = param.unset === true
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground text-xs">
              {param.label}
            </Label>
            <ParamTooltip tooltip={param.tooltip} />
          </div>
          {isUnset ? (
            <span className="text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">
              Auto
            </span>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-foreground bg-muted/50 rounded px-1.5 py-0.5 font-mono text-xs">
                {param.value}
              </span>
              {param.onReset && (
                <button
                  type="button"
                  aria-label={`Reset ${param.label} to default`}
                  onClick={param.onReset}
                  className="hover:bg-muted/20 text-muted-foreground flex h-5 w-5 items-center justify-center rounded"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>
        <Slider
          value={[param.value]}
          min={param.min}
          max={param.max}
          step={param.step}
          onValueChange={([v]) => param.onChange(v)}
          className={cn(isUnset && 'opacity-50')}
        />
      </div>
    )
  }

  if (param.type === 'checkbox-group') {
    return (
      <div className="space-y-2">
        <Label className="text-muted-foreground text-xs">{param.label}</Label>
        <div className="space-y-1.5">
          {param.options.map((o) => (
            <label
              key={o.value}
              className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 select-none"
            >
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                  o.checked
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/40',
                )}
              >
                {o.checked && (
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 6l2.5 2.5 4.5-4.5" />
                  </svg>
                )}
              </span>
              <span className="text-foreground text-xs">{o.label}</span>
              <input
                type="checkbox"
                className="sr-only"
                checked={o.checked}
                onChange={(e) => param.onChange(o.value, e.target.checked)}
              />
            </label>
          ))}
          {param.options.length === 0 && (
            <p className="text-muted-foreground text-xs">No items available</p>
          )}
        </div>
      </div>
    )
  }

  if (param.type === 'textarea') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label className="text-muted-foreground text-xs">{param.label}</Label>
          <ParamTooltip tooltip={param.tooltip} />
        </div>
        <Textarea
          value={param.value}
          onChange={(e) => param.onChange(e.target.value)}
          placeholder={param.placeholder}
          rows={param.rows ?? 3}
          className="bg-muted/30 resize-none text-xs"
        />
      </div>
    )
  }

  if (param.type === 'toggle') {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label className="text-muted-foreground text-xs">{param.label}</Label>
          <ParamTooltip tooltip={param.tooltip} />
        </div>
        <Switch checked={param.checked} onCheckedChange={param.onChange} />
      </div>
    )
  }

  if (param.type === 'select') {
    return (
      <div className="space-y-2" data-testid={`param-${param.id}`}>
        <div className="flex items-center gap-2">
          <Label className="text-muted-foreground text-xs">{param.label}</Label>
          <ParamTooltip tooltip={param.tooltip} />
          {param.onRefresh && (
            <Button
              onClick={param.onRefresh}
              disabled={param.isRefreshing}
              variant="ghost"
              className="hover:bg-muted/50 ml-auto flex h-5 w-5 items-center justify-center rounded"
            >
              <RefreshCw
                className={cn(
                  'text-muted-foreground h-3 w-3',
                  param.isRefreshing && 'animate-spin',
                )}
              />
            </Button>
          )}
        </div>
        <Select value={param.value} onValueChange={param.onChange}>
          <SelectTrigger className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {param.options.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                <span className="flex items-center gap-1.5">
                  {o.downloaded != null &&
                    (o.downloaded ? (
                      <CheckCircle2 className="text-success h-3 w-3 shrink-0" />
                    ) : (
                      <Download className="text-muted-foreground h-3 w-3 shrink-0" />
                    ))}
                  {o.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {param.hint && (
          <p className="text-warning flex items-center gap-1 text-[10px]">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {param.hint}
          </p>
        )}
      </div>
    )
  }

  return null
}
