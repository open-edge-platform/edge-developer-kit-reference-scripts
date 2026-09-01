// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Check, Hand, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionHint } from "@/components/kiosk/action-hint";
import { IconTile } from "@/components/kiosk/icon-tile";
import { TapCard } from "@/components/kiosk/tap-card";
import { cn } from "@/lib/utils";

/** Kiosk-sized labelled text input for service-specific application steps. */
export function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Extra guidance under the box, e.g. the format expected. */
  hint?: string;
  className?: string;
}) {
  const filled = value.trim().length > 0;
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <Label htmlFor={id} className="flex items-center gap-2 text-base font-semibold text-muted-foreground">
        {label}
        {filled && <Check className="size-4 animate-ks-pop text-success" strokeWidth={3} />}
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-15 rounded-2xl border-[1.5px] bg-field px-5 text-lg font-medium transition-colors md:text-lg",
          filled && "border-ring/60",
        )}
      />
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Prompt above a field group that follows other content, e.g. "Renewal period". */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-6 mb-2 text-base font-semibold text-muted-foreground", className)}>
      {children}
    </div>
  );
}

/** Small-caps heading over a list of records, e.g. "2 vehicles found". */
export function ListHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-2 text-base font-bold tracking-[0.1em] text-muted-foreground/80 uppercase",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type Option = {
  id: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
};

/**
 * Single-choice grid of large tap targets (license class, purpose, program…).
 * Laid out with wrapping flex rather than grid so a partial last row — e.g. a
 * single eligible license class — centers itself instead of hugging the left.
 */
export function OptionCards({
  options,
  value,
  onSelect,
  columns = 3,
  prompt = "Tap one of the options below",
}: {
  options: Option[];
  value: string | null;
  onSelect: (id: string) => void;
  columns?: 2 | 3 | 4;
  /** The nudge shown until something is picked; pass false to suppress it
   *  when the surrounding step already says what to do. */
  prompt?: string | false;
}) {
  return (
    <>
      {prompt && !value && <ActionHint icon={Hand}>{prompt}</ActionHint>}
      <div className="ks-stagger flex flex-wrap justify-center gap-4">
      {options.map((option) => (
        <TapCard
          key={option.id}
          onClick={() => onSelect(option.id)}
          selected={option.id === value}
          className={cn(
            "flex w-full flex-col items-center gap-3 rounded-[20px] p-7 text-center",
            {
              2: "md:w-[calc((100%-1rem)/2)]",
              3: "md:w-[calc((100%-2rem)/3)]",
              4: "md:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-3rem)/4)]",
            }[columns],
          )}
        >
          {option.icon && (
            <IconTile icon={option.icon} className="size-16 rounded-2xl" iconClassName="size-8" />
          )}
          <div className="flex items-center gap-2 text-lg font-bold">
            {option.id === value && (
              <Check className="size-5 animate-ks-pop text-primary" strokeWidth={3} />
            )}
            {option.label}
          </div>
          {option.hint && <div className="text-sm text-muted-foreground">{option.hint}</div>}
        </TapCard>
        ))}
      </div>
    </>
  );
}
