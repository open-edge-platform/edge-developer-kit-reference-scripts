// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Activity, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { PageHeading } from '@/components/shell/page-heading'
import { Button } from '@/components/ui/button'
import { DashboardHero } from './dashboard-hero'
import { DashboardOverview } from './dashboard-overview'

// No title of its own: the home page goes by the app's name (the root
// layout's default title — its template only applies to nested routes).
export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeading title="Dashboard">
        <Button variant="outline" asChild className="bg-card">
          <Link href="/system-monitoring">
            <Activity />
            System monitor
            <ArrowUpRight className="text-muted-foreground" />
          </Link>
        </Button>
      </PageHeading>

      <DashboardHero />

      <DashboardOverview />
    </div>
  )
}
