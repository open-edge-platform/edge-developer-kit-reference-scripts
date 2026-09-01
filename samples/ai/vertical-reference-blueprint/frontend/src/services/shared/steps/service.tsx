// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import {
  BookText,
  CarFront,
  ChevronRight,
  FolderClock,
  Hand,
  House,
  IdCard,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionHint } from "@/components/kiosk/action-hint";
import { Spinner } from "@/components/ui/spinner";
import { IconTile } from "@/components/kiosk/icon-tile";
import { LoadFailed } from "@/components/kiosk/status-block";
import { TapCard } from "@/components/kiosk/tap-card";
import { useCatalog } from "@/hooks/use-kiosk-api";
import { countOf } from "@/lib/format";
import type { CategoryDefinition, CategoryIconId, ServiceDefinition } from "@/services/types";
import type { StepProps } from "../step-props";
import { StepShell } from "../step-shell";

const CATEGORY_ICONS: Record<CategoryIconId, LucideIcon> = {
  car: CarFront,
  book: BookText,
  "id-card": IdCard,
  house: House,
  users: Users,
  shield: ShieldCheck,
};

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

  return category ? (
    <ServiceList category={category} onSelect={actions.selectService} />
  ) : (
    <CategoryGrid
      categories={categories}
      onSelect={actions.selectCategory}
      onOpenRequests={actions.openRequests}
    />
  );
}

function CategoryGrid({
  categories,
  onSelect,
  onOpenRequests,
}: {
  categories: CategoryDefinition[];
  onSelect: (categoryId: string) => void;
  onOpenRequests: () => void;
}) {
  return (
    <StepShell title="What would you like to do?" subtitle="Choose a service category to get started.">
      <ActionHint icon={Hand}>Tap a category below to see what it covers</ActionHint>
      <div className="ks-stagger grid gap-5 md:grid-cols-2">
        {categories.map((category) => {
          const count = category.groups.reduce((n, group) => n + group.services.length, 0);
          return (
            <TapCard
              key={category.id}
              onClick={() => onSelect(category.id)}
              className="flex min-h-32 items-center gap-5 p-7"
            >
              <IconTile icon={CATEGORY_ICONS[category.icon]} />
              <div className="min-w-0 flex-1">
                <div className="text-2xl font-bold">{category.label}</div>
                <div className="mt-1 text-base text-muted-foreground">{category.description}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2.5">
                <Badge className="rounded-full bg-accent px-3.5 py-1.5 text-sm font-bold text-primary">
                  {countOf(count, "service")}
                </Badge>
                <ChevronRight className="size-6 text-border" />
              </div>
            </TapCard>
          );
        })}
      </div>
      {/* Narrower than the grid and centered, so it reads as a compact
          action instead of stretching like a category row. */}
      <TapCard
        onClick={onOpenRequests}
        className="mx-auto mt-5 flex min-h-24 w-full max-w-xl flex-col items-center justify-center gap-1.5 p-6 text-center"
      >
        <div className="flex items-center gap-3">
          <FolderClock className="size-7 text-primary" />
          <div className="text-2xl font-bold">My Requests</div>
        </div>
        <div className="text-base text-muted-foreground">
          Resume a saved application or check one that is pending review.
        </div>
      </TapCard>
    </StepShell>
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
        <div className="text-sm font-bold tracking-[0.16em] text-cyan uppercase">Category</div>
        <h1 className="mt-1 truncate font-heading text-3xl font-bold tracking-tight lg:text-4xl">
          {category.label}
        </h1>
      </div>
      <ActionHint icon={Hand}>Tap the service you came for — you can go back at any time</ActionHint>
      {category.groups.map((group) => (
        <div key={group.label} className="mb-8">
          <div className="mb-3.5 ml-1.5 flex items-center gap-3.5">
            <span className="text-sm font-bold tracking-[0.16em] text-muted-foreground/80 uppercase">
              {group.label}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <div className="ks-stagger flex flex-col gap-4">
            {group.services.map((service) => (
              <TapCard
                key={service.id}
                onClick={() => onSelect(service)}
                className="flex min-h-26 items-center gap-6 rounded-[22px] px-8 py-7"
              >
                <span className="size-3.5 shrink-0 rounded-full bg-cyan shadow-[0_0_14px_var(--color-cyan)]" />
                <div className="min-w-0 flex-1">
                  <div className="font-heading text-2xl font-bold">{service.label}</div>
                  <div className="mt-1 text-base text-muted-foreground">{service.description}</div>
                </div>
                <ChevronRight className="size-6 shrink-0 text-border" />
              </TapCard>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
