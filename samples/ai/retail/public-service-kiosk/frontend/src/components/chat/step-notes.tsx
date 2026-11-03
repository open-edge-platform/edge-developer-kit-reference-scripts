// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { CircleAlert, CircleHelp, IdCard } from "lucide-react";
import { DEVICE_STEP_REPLY } from "@/app/api/_lib/flows/types";
import type { Ask } from "@/app/api/_lib/flows/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** What the kiosk says back when a physical step is answered with words. */
export function StepNag({
  help,
  intro,
  openHelp,
  children,
}: {
  help: string;
  /** Replaces the "you answered in words" line — also used when a step keeps failing. */
  intro?: string;
  openHelp?: boolean;
  children: React.ReactNode;
}) {
  const [stuck, setStuck] = useState(openHelp ?? false);
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-left">
      <p className="text-lg text-pretty">{intro ?? DEVICE_STEP_REPLY}</p>
      <div className="flex flex-wrap gap-3">
        {children}
        <Button
          variant="outline"
          className="h-13 rounded-2xl px-6 text-lg"
          onClick={() => setStuck((open) => !open)}
        >
          <CircleHelp className="size-6" />
          I can&apos;t do this
        </Button>
      </div>
      {stuck && <p className="text-lg text-pretty text-muted-foreground">{help}</p>}
    </div>
  );
}

/** Drawn as an alert only when the note is a refusal. */
export function StepNote({ text, tone }: { text: string; tone: Ask["noteTone"] }) {
  const alert = tone === "alert";
  const Icon = alert ? CircleAlert : IdCard;
  return (
    <div
      className={cn(
        "mt-4 flex items-start gap-2.5 rounded-2xl px-4 py-3 text-left text-base font-medium",
        alert ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0" />
      <span className="text-pretty">{text}</span>
    </div>
  );
}
