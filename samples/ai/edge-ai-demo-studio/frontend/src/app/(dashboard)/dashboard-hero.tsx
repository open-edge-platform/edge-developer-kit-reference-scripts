// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowRight, Cpu, Server } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

/** The dashboard's welcome banner, with its two ways in: samples and services. */
export function DashboardHero() {
  return (
    // The hero keeps its Intel-blue gradient in both themes, so its colours
    // are fixed (white, white/alpha, intel-blue), not tokens.
    <section
      aria-labelledby="welcome-title"
      className="studio-hero relative overflow-hidden rounded-2xl px-6 py-8 text-white sm:px-8 sm:py-9 lg:min-h-52"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="hero-orbit opacity-50 sm:opacity-100" />
        <div className="hero-orbit mr-[-80px] scale-150 opacity-40" />
        <div className="hero-chip absolute top-16 right-20 hidden size-28 items-center justify-center rounded-3xl border border-white/25 bg-white/10 lg:flex">
          <Cpu className="size-14 text-white/90" strokeWidth={1} />
        </div>
      </div>
      <div className="relative max-w-xl lg:max-w-[65%]">
        <h2
          id="welcome-title"
          className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl"
        >
          Edge AI Demo Studio
        </h2>
        <p className="mt-3 max-w-md text-sm leading-6 text-white/85">
          Run AI samples and services on this machine.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            asChild
            className="text-intel-blue h-10 border-white bg-white px-4 shadow-sm hover:bg-white/90"
          >
            <Link href="/samples">
              Explore samples
              <ArrowRight />
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="h-10 border-white/30 bg-white/5 px-4 text-white hover:bg-white/15 hover:text-white"
          >
            <Link href="/services">
              <Server />
              Manage services
            </Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
