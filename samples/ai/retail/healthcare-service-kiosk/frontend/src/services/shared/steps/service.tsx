// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { createElement, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, FileText, FolderClock, Hand, IdCard, LayoutGrid, Wallet } from "lucide-react";
import { ActionHint } from "@/components/kiosk/action-hint";
import { EmergencyBanner } from "@/components/kiosk/emergency-banner";
import { Spinner } from "@/components/ui/spinner";
import { IconTile } from "@/components/kiosk/icon-tile";
import { CATEGORY_ICONS, serviceIcon } from "@/components/kiosk/service-icons";
import { LoadFailed } from "@/components/kiosk/status-block";
import { TapCard } from "@/components/kiosk/tap-card";
import { ForYouPanel, SignInBanner } from "@/components/kiosk/for-you-panel";
import { useCatalog } from "@/hooks/use-kiosk-api";
import type { KioskFlowActions } from "@/hooks/use-kiosk-flow";
import { countOf, formatMoney } from "@/lib/format";
import { slotsOf, type HomePanel } from "@/modules/slots";
import { activePack } from "@/packs";
import type { CategoryDefinition, ServiceDefinition } from "@/services/types";
import type { StepProps } from "../step-props";

export default function ServiceStep({ state, actions }: StepProps) {
  const catalog = useCatalog();

  if (catalog.isPending) {
    return <Spinner className="size-12 text-primary" />;
  }
  if (catalog.isError) {
    return (
      <LoadFailed message="Could not load the service catalog" onRetry={() => catalog.refetch()} />
    );
  }

  const categories = catalog.data.categories;
  const category = categories.find((c) => c.id === state.categoryId);
  const offered = categories.flatMap((c) => c.groups.flatMap((group) => group.services));
  const panels = slotsOf("homePanels").flatMap((panel) => {
    const service = offered.find((s) => s.id === panel.service);
    return service ? [{ panel, service }] : [];
  });

  return category ? (
    <ServiceList category={category} onSelect={actions.selectService} />
  ) : (
    <CategoryGrid
      categories={categories}
      onSelect={actions.selectCategory}
      onSelectService={actions.selectService}
      onOpenRequests={actions.openRequests}
      signedIn={Boolean(state.identity && state.profile)}
      personal={
        state.identity && state.profile ? (
          <ForYouPanel
            documentNumber={state.identity.documentNumber}
            profile={state.profile}
            services={offered}
            onSelect={actions.selectService}
          />
        ) : (
          <SignInBanner onSignIn={actions.openSignIn} />
        )
      }
      panels={panels}
      actions={actions}
    />
  );
}

function CategoryGrid({
  categories,
  onSelect,
  onSelectService,
  onOpenRequests,
  personal,
  signedIn,
  panels,
  actions,
}: {
  categories: CategoryDefinition[];
  onSelect: (categoryId: string) => void;
  onSelectService: (service: ServiceDefinition) => void;
  onOpenRequests: () => void;
  personal: React.ReactNode;
  signedIn: boolean;
  /** Home tiles other modules add, each opening a panel of its own (see src/modules/slots.ts). */
  panels: { panel: HomePanel; service: ServiceDefinition }[];
  actions: KioskFlowActions;
}) {
  const [section, setSection] = useState("home");
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current?.closest("main")?.scrollTo({ top: 0 });
  }, [section]);
  const featured = categories
    .flatMap((category) => category.groups.flatMap((group) => group.services.map((service) => ({ service, category }))))
    .filter(({ service }) => service.featured !== undefined)
    .sort((a, b) => a.service.featured! - b.service.featured!)
    .slice(0, 4);
  const open = panels.find(({ panel }) => panel.id === section);
  const titles: Record<string, string> = { home: "How can we help you?", services: "All services", personal: "Your visit" };

  return (
    <div ref={menu} className="hc-service-menu w-full max-w-6xl animate-ks-fade">
      <div className="hc-service-heading mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-sm font-semibold tracking-widest text-primary uppercase">Patient services</p>
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">{open?.panel.title ?? titles[section]}</h1>
          <p className="mt-2 text-lg text-muted-foreground">
            {section === "home" ? "Choose what you need. We’ll take it one step at a time." : "Choose an option below to continue."}
          </p>
        </div>
        {section !== "home" && (
          <button onClick={() => setSection("home")} className="flex min-h-14 items-center gap-2 rounded-xl border bg-card px-5 text-base font-semibold">
            <ArrowLeft className="size-5" aria-hidden /> Main menu
          </button>
        )}
      </div>

      {section === "home" && (
        <>
          <div className="hc-home-grid grid gap-4 sm:grid-cols-2 lg:landscape:grid-cols-3" aria-label="Popular services">
            {featured.map(({ service, category }) => (
              <TapCard key={service.id} onClick={() => onSelectService(service)} className="hc-service-card group flex min-h-36 items-center gap-4 rounded-2xl p-5 sm:p-6">
                <IconTile icon={serviceIcon(service, category.icon)} className="size-14 rounded-2xl border-0 bg-accent bg-none" iconClassName="size-7" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl leading-tight font-semibold">{service.label}</h2>
                  <p className="mt-2 text-base leading-snug text-muted-foreground">{QUICK_HINTS[service.id] ?? service.description}</p>
                </div>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </TapCard>
            ))}
            {panels.map(({ panel }) => (
              <TapCard key={panel.id} onClick={() => setSection(panel.id)} className="hc-service-card group flex min-h-36 items-center gap-4 rounded-2xl border-primary/30 bg-accent/50 p-5 sm:p-6">
                <IconTile icon={panel.icon} className="size-14 rounded-2xl border-0 bg-card bg-none" iconClassName="size-7" />
                <div className="flex-1"><h2 className="text-xl font-semibold">{panel.title}</h2><p className="mt-2 text-base text-muted-foreground">{panel.detail}</p></div>
                <ChevronRight className="size-5 shrink-0 text-primary" aria-hidden />
              </TapCard>
            ))}
            <TapCard onClick={() => setSection("services")} className="hc-service-card flex min-h-36 items-center gap-4 rounded-2xl p-5 sm:p-6">
              <IconTile icon={LayoutGrid} className="size-14 rounded-2xl border-0 bg-accent bg-none" iconClassName="size-7" />
              <div className="flex-1"><h2 className="text-xl font-semibold">All services</h2><p className="mt-2 text-base text-muted-foreground">Browse everything we can help with</p></div>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            </TapCard>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border bg-card/60 p-3">
            <div className="min-w-0 flex-1">
              {signedIn ? (
                <button onClick={() => setSection("personal")} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left text-lg font-semibold hover:bg-accent">
                  <IdCard className="size-6 text-primary" aria-hidden /> Your appointments, results and bills <ChevronRight className="ml-auto size-5 shrink-0" aria-hidden />
                </button>
              ) : personal}
            </div>
            <button onClick={onOpenRequests} className="flex min-h-14 items-center gap-2 rounded-xl px-4 text-base font-semibold hover:bg-accent">
              <FolderClock className="size-5 text-primary" aria-hidden /> My Requests
            </button>
          </div>
          <EmergencyBanner className="mt-5 rounded-xl bg-transparent py-3 [&_p]:text-base [&_svg]:size-5" />
        </>
      )}

      {section === "personal" && personal}
      {open && createElement(open.panel.Panel, { service: open.service, actions })}
      {section === "services" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((category) => (
            <TapCard key={category.id} onClick={() => onSelect(category.id)} className="flex min-h-24 items-center gap-4 rounded-2xl p-5">
              <IconTile icon={CATEGORY_ICONS[category.icon]} className="size-12 rounded-xl border-0 bg-accent bg-none" iconClassName="size-6" />
              <div className="min-w-0 flex-1"><h2 className="text-xl font-semibold">{category.label}</h2><p className="mt-1 text-base text-muted-foreground">{category.description}</p></div>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            </TapCard>
          ))}
        </div>
      )}
    </div>
  );
}

const QUICK_HINTS: Record<string, string> = {
  checkin: "Arrive for your appointment",
  doctors: "Search by name or specialty",
  bill: "View and pay your bills",
  labresults: "View your test results",
};

function ServiceFacts({ service }: { service: ServiceDefinition }) {
  const { currency } = activePack().locale;
  const rates = service.pricing ? Object.values(service.pricing.rates) : [];
  // A zero fee with a payment step may be priced by the chain's quote (bills, refills) — only the server knows.
  const fee = rates.length > 0
    ? `From ${formatMoney(Math.min(...rates), currency)}`
    : service.fee > 0
      ? formatMoney(service.fee, currency)
      : service.flow.includes("payment")
        ? null
        : "Free";
  const facts = [
    fee && { icon: Wallet, label: fee },
    (service.flow.includes("identity") || service.flow.includes("enroll")) && { icon: IdCard, label: "ID card needed" },
    service.documents.length > 0 && { icon: FileText, label: countOf(service.documents.length, "document") },
  ].filter(Boolean) as { icon: typeof Wallet; label: string }[];

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {facts.map(({ icon: Icon, label }) => (
        <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-sm font-medium text-ink">
          <Icon className="size-4 text-primary" aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}

function ServiceList({
  category,
  onSelect,
}: {
  category: CategoryDefinition;
  onSelect: (service: ServiceDefinition) => void;
}) {
  return (
    <div className="w-full max-w-4xl animate-ks-fade">
      <div className="mb-7">
        <div className="text-sm font-bold tracking-[0.18em] text-primary uppercase">Patient services</div>
        <h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight lg:text-4xl">
          {category.label}
        </h1>
      </div>
      <ActionHint icon={Hand}>Tap the service you came for — you can go back at any time</ActionHint>
      {category.groups.map((group) => (
        <div key={group.label} className="mb-8">
          <div className="mb-3.5 ml-1.5 flex items-center gap-3.5">
            <span className="text-sm font-bold tracking-[0.16em] text-muted-foreground uppercase">
              {group.label}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <div className="ks-stagger flex flex-col gap-4">
            {group.services.map((service) => (
              <TapCard
                key={service.id}
                onClick={() => onSelect(service)}
                className="flex min-h-26 items-center gap-4 rounded-2xl px-5 py-6 sm:gap-6 sm:px-8"
              >
                <IconTile icon={serviceIcon(service, category.icon)} className="size-14 rounded-xl border-0 bg-accent bg-none" iconClassName="size-7" />
                <div className="min-w-0 flex-1">
                  <div className="font-heading text-xl font-semibold sm:text-2xl">{service.label}</div>
                  <div className="mt-1 text-base text-muted-foreground">{service.description}</div>
                  <ServiceFacts service={service} />
                </div>
                <ChevronRight className="size-6 shrink-0 text-muted-foreground" />
              </TapCard>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
