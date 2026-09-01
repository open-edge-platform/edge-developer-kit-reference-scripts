// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The desk's form kit.
 *
 * Deliberately not the kiosk's (services/shared/fields.tsx): that one is
 * built for somebody standing at a touch screen — 60px targets, one question
 * at a time. This is a keyboard-driven counter form a staff member fills in
 * dozens of times a day, so the fields are dense, tab in reading order, and
 * say which ones the registry actually requires.
 */

const CONTROL =
  "h-10 rounded-xl border-[1.5px] bg-field px-3 text-sm transition-colors md:text-sm";

function FieldShell({
  id,
  label,
  required,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function DeskField({
  id,
  label,
  value,
  onChange,
  required,
  hint,
  placeholder,
  type = "text",
  className,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  type?: "text" | "number" | "email" | "tel";
  className?: string;
  disabled?: boolean;
}) {
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} className={className}>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={CONTROL}
      />
    </FieldShell>
  );
}

/**
 * A native select, styled to match. The registry's own fields are short closed
 * lists and a native control is what a keyboard user at a counter expects —
 * type the first letter, tab on.
 */
export function DeskSelect({
  id,
  label,
  value,
  onChange,
  options,
  required,
  hint,
  placeholder = "—",
  className,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} className={className}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          CONTROL,
          "w-full border-input outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function DeskCheckbox({
  id,
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-10 items-center gap-2.5">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => onChange(next === true)}
        />
        <Label htmlFor={id} className="text-sm font-normal">
          {label}
        </Label>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
