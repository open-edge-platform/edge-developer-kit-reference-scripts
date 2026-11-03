// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Clock, LayoutGrid, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The wipe between citizens, announced with a way out. */
export function RestartNotice({
  secondsLeft,
  signedIn,
  onNow,
  onHold,
  onAnother,
}: {
  /** Null once the citizen has held the clock — nothing is counting. */
  secondsLeft: number | null;
  /** The patient verified in this chat: Start over also signs them out. */
  signedIn?: boolean;
  onNow: () => void;
  onHold: () => void;
  /** Another service in the same visit — the conversation, and the sign-in, carry on. */
  onAnother?: () => void;
}) {
  const counting = secondsLeft !== null;
  return (
    <div className="flex flex-col gap-3.5 rounded-3xl border bg-card p-5">
      <div>
        <div className="text-base font-semibold">All done — thank you!</div>
        <p className="text-base text-muted-foreground text-pretty">
          {counting
            ? `Ask me anything else — or this chat resets for the next person in ${secondsLeft}s.`
            : "Take your time. Tap Start over when you're ready — that begins a new " +
              "request, for you or for the next person."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <Button className="h-14 rounded-2xl px-6 text-lg font-semibold" onClick={onNow}>
          <RotateCcw className="size-5" />
          {signedIn ? "Finish & sign out" : "Start over now"}
        </Button>
        {onAnother && (
          <Button variant="outline" className="h-14 rounded-2xl px-6 text-lg" onClick={onAnother}>
            <LayoutGrid className="size-5" />
            Something else
          </Button>
        )}
        {counting && (
          <Button variant="outline" className="h-14 rounded-2xl px-6 text-lg" onClick={onHold}>
            <Clock className="size-5" />
            I need more time
          </Button>
        )}
      </div>
    </div>
  );
}
