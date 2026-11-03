// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Angry, Check, Frown, Hand, Laugh, Meh, Smile, type LucideIcon } from "lucide-react";
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
            "hc-option-card flex w-full flex-col items-center gap-3 rounded-[20px] p-7 text-center",
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

/** Pill chips for short answers (languages, topics, areas) — denser than OptionCards, still kiosk-sized. */
export function ChoiceChips({
  options,
  value,
  onSelect,
  label,
  prompt,
}: {
  options: { id: string; label: string }[];
  value: string | null;
  onSelect: (id: string) => void;
  label: string;
  prompt?: string;
}) {
  return (
    <>
      {prompt && !value && <ActionHint icon={Hand}>{prompt}</ActionHint>}
      <div className="flex flex-wrap gap-3" role="group" aria-label={label}>
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(option.id)}
              className={cn(
                "inline-flex min-h-14 cursor-pointer items-center gap-2 rounded-full border-2 px-6 py-2 text-left text-lg font-semibold transition-colors",
                "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                selected
                  ? "border-ring bg-selected text-foreground"
                  : "border-input bg-background text-ink hover:border-primary/40",
              )}
            >
              {selected && <Check className="size-5 shrink-0 animate-ks-pop text-primary" strokeWidth={3} />}
              {option.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

const RATING_FACES: LucideIcon[] = [Angry, Frown, Meh, Smile, Laugh];

/** 1–5 satisfaction scale with faces, worst on the left. */
export function RatingScale({
  labels,
  value,
  onSelect,
}: {
  /** Five labels, worst first. */
  labels: string[];
  value: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-3" role="group" aria-label="Rating">
      {labels.map((label, i) => {
        const id = String(i + 1);
        const Face = RATING_FACES[i];
        return (
          <TapCard
            key={id}
            selected={id === value}
            onClick={() => onSelect(id)}
            className="flex flex-col items-center gap-2 rounded-2xl px-2 py-5 text-center"
          >
            <Face className={cn("size-12", id === value ? "text-primary" : "text-muted-foreground")} strokeWidth={1.6} />
            <span className="text-base leading-tight font-semibold">{label}</span>
          </TapCard>
        );
      })}
    </div>
  );
}
