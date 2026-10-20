// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { LucideIcon } from "lucide-react";
import { LookupPending } from "@/components/kiosk/spinner-ring";
import { LoadFailed } from "@/components/kiosk/status-block";

/**
 * Standard triage around a registry read: spinner while it loads, retry when
 * it fails, the step's content once data arrives. Children are rendered
 * eagerly, so read records with a `?? []` fallback.
 */
export function LookupGate({
  lookup,
  icon,
  title,
  description,
  errorMessage,
  children,
}: {
  lookup: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  icon: LucideIcon;
  title: string;
  description: string;
  /** What could not be reached, e.g. "The license registry could not be reached" — no trailing period. */
  errorMessage: string;
  children: React.ReactNode;
}) {
  if (lookup.isLoading) {
    return <LookupPending icon={icon} title={title} description={description} />;
  }
  if (lookup.isError) {
    return <LoadFailed message={errorMessage} onRetry={() => lookup.refetch()} />;
  }
  return <>{children}</>;
}
