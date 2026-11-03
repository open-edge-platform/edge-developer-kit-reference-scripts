// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { ArrowUpRight, ChevronDown, ClipboardList } from "lucide-react";
import { REQUESTS_FLOW_ID } from "@/app/api/_lib/flows/types";
import { CATEGORY_ICONS } from "@/components/kiosk/service-icons";
import { categories, type CategoryDefinition, type ServiceDefinition } from "@/services";

const QUICK_SERVICES = ["roadtax", "fine", "dl_renew", "idcard", "address", "police"];
const chip = "group flex min-h-14 items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function ServiceChips({ onStart }: { onStart: (serviceId: string, label: string) => void }) {
  const catalog = categories();
  const servicesOf = (category: CategoryDefinition) => category.groups.flatMap((group) => group.services);
  // Services carry no glyph of their own here: each wears its category's.
  const iconOf = new Map(
    catalog.flatMap((category) => servicesOf(category).map((service) => [service.id, CATEGORY_ICONS[category.icon]] as const)),
  );
  const all = catalog.flatMap(servicesOf);
  const popular = QUICK_SERVICES.map((id) => all.find((service) => service.id === id)).filter(
    (service): service is ServiceDefinition => Boolean(service),
  );
  const renderService = (service: ServiceDefinition) => {
    const Icon = iconOf.get(service.id)!;
    return (
      <button key={service.id} type="button" onClick={() => onStart(service.id, service.label)} className={chip}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary"><Icon className="size-5" aria-hidden /></span>
        <span className="flex-1 text-base font-medium">{service.label}</span>
        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden />
      </button>
    );
  };
  return (
    <section aria-label="Choose a service" className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Popular services">
        {popular.map(renderService)}
      </div>
      <details className="group/services rounded-2xl border bg-card">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 text-base font-semibold focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          Browse all services
          <ChevronDown className="size-5 transition-transform group-open/services:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-5 border-t p-3 sm:p-4">
          {catalog.map((category) => (
            <section key={category.id} aria-label={category.label}>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{category.label}</h3>
              <div className="grid gap-2 sm:grid-cols-2">{servicesOf(category).map(renderService)}</div>
            </section>
          ))}
        </div>
      </details>
      <button type="button" onClick={() => onStart(REQUESTS_FLOW_ID, "My Requests")} className="flex min-h-12 items-center gap-2 self-start rounded-xl px-3 text-sm font-medium text-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
        <ClipboardList className="size-5" aria-hidden /> View my requests
      </button>
    </section>
  );
}
