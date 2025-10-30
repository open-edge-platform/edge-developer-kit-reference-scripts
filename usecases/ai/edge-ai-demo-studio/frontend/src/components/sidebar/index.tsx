// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import * as React from 'react'
import { Zap } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { samples, workloads } from '@/utils/workloads'
import { useGetWorkloadsStatus } from '@/hooks/use-workload'
import { statusMap } from '@/utils/common'

// Navigation data
const navigationData = {
  aiServices: [
    ...workloads.map((workload) => {
      return {
        title: workload.title,
        url: workload.href,
        icon: workload.icon,
        type: workload.type,
      }
    }),
  ],
  samples: [
    ...samples.map((sample) => {
      return {
        title: sample.title,
        url: sample.href,
        icon: sample.icon,
        type: sample.type,
      }
    }),
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { data } = useGetWorkloadsStatus()

  const workloads = React.useMemo(() => {
    return (data || []).map((workload) => {
      const statusKey = workload.status ?? 'inactive'
      const status = statusMap[statusKey] || {
        status: 'Unknown',
        color: 'bg-gray-300',
      }
      return {
        ...workload,
        status: {
          status: workload.status,
          text: status.status,
          color: status.color,
        },
      }
    })
  }, [data])

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="text-sidebar-primary-foreground bg-primary flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Zap className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    Edge AI Demo Studio
                  </span>
                  <span className="truncate text-xs">AI at the Edge</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* AI Services */}
        <SidebarGroup>
          <SidebarGroupLabel>AI Services</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationData.aiServices.map((item) => {
                const workload = workloads.find((w) => w.type === item.type)
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={pathname === item.url}>
                      <Link
                        href={item.url}
                        className="flex w-full items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <item.icon />
                          <span>{item.title}</span>
                        </div>
                        <div
                          className={`h-2 w-2 rounded-full ${workload?.status.color ?? 'bg-gray-300'}`}
                        />
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* AI Services */}
        <SidebarGroup>
          <SidebarGroupLabel>Samples</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationData.samples.map((item) => {
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={pathname === item.url}>
                      <Link
                        href={item.url}
                        className="flex w-full items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <item.icon />
                          <span>{item.title}</span>
                        </div>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
