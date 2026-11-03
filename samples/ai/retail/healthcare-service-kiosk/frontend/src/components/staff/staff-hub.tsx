// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import Link from "next/link";
import {
  ArrowUpRight,
  ClipboardList,
  Database,
  FileStack,
  LayoutDashboard,
  Mail,
  MonitorSmartphone,
  SlidersHorizontal,
  Ticket,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Panel } from "@/components/staff/desk-shell";
import { Badge } from "@/components/ui/badge";
import { MODULES } from "@/modules/manifest";
import { enabledModules } from "@/modules/state";
import type { NamedModule } from "@/modules/types";
import { allCategories } from "@/services/catalog";

type Page = { href: string; title: string; detail: string; icon: LucideIcon; when?: boolean };

/** /staff — every staff page in one place, and which parts this terminal runs. Linked from nowhere a patient can reach. */
export function StaffHub({ staffEmail }: { staffEmail: string }) {
  const on = enabledModules();
  const pages: Page[] = [
    { href: "/enroll", title: "Registration desk", detail: "Register a patient with their portrait and card, or give a registered patient a card.", icon: UserPlus },
    { href: "/settings#modules", title: "Kiosk settings", detail: "This terminal's config.yaml — modules, AI services, peripherals — and the restart that applies it.", icon: SlidersHorizontal },
    { href: "/mock-documents", title: "Mock documents", detail: "A patient's genuine and tampered test documents and codes, to print or to present to this kiosk's simulated peripherals.", icon: FileStack },
    { href: "/outbox", title: "Outbox", detail: "SMS and email confirmations, results by email, and arrival notes to the clinics.", icon: Mail },
    { href: "/admin/collections/citizens", title: "Patient registry", detail: "Particulars, dates of birth, portraits and cards, in the CMS.", icon: Database },
    { href: "/admin/collections/applications", title: "Cases", detail: "Everything filed at the kiosk: check-ins, bookings, refills, surveys.", icon: ClipboardList },
    { href: "/queue", title: "Queue board", detail: "Today's clinic queues, for the waiting-area display.", icon: Ticket, when: on("queue") },
    { href: "/admin", title: "CMS admin", detail: "Every collection, and the admin accounts.", icon: LayoutDashboard },
    { href: "/", title: "Patient kiosk", detail: "The patient screen, as this terminal runs it.", icon: MonitorSmartphone },
  ];
  const features = MODULES.filter((m): m is NamedModule => m.kind === "feature");
  const categories = allCategories();
  const services = categories.flatMap((c) => c.groups.flatMap((g) => g.services));
  const off = services.filter((s) => !on(s.id));

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Staff pages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reached by address only — nothing on the patient screen links here.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{staffEmail}</span>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pages
          .filter((page) => page.when !== false)
          .map(({ href, title, detail, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-ring"
            >
              <span className="flex items-center justify-between">
                <Icon className="size-5 text-primary" aria-hidden />
                <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-foreground" aria-hidden />
              </span>
              <span className="font-heading text-base font-semibold">{title}</span>
              <span className="text-sm text-muted-foreground">{detail}</span>
              <code className="mt-auto text-xs text-muted-foreground">{href}</code>
            </Link>
          ))}
      </div>

      <Panel
        title="Modules on this terminal"
        note="What the running kiosk offers. Switch modules on and off under Kiosk settings → Modules; npm run modules takes them out of the code."
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            {features.map((feature) => (
              <Badge key={feature.id} variant={on(feature.id) ? "secondary" : "outline"} title={feature.summary}>
                {feature.title}: {on(feature.id) ? "on" : "off"}
              </Badge>
            ))}
          </div>
          <p className="text-sm">
            {services.length - off.length} of {services.length} services on
            {off.length > 0 && (
              <span className="text-muted-foreground"> — off: {off.map((s) => s.label).join(", ")}</span>
            )}
          </p>
        </div>
      </Panel>
    </div>
  );
}
