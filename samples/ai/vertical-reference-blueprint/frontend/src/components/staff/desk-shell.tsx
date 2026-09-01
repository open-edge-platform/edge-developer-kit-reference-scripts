// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { ApiError } from "@/lib/api/client";

/** One titled section of a desk form. */
export function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="font-heading text-sm font-semibold tracking-tight">{title}</h2>
      {note ? (
        <p className="mt-1 mb-4 text-xs text-muted-foreground">{note}</p>
      ) : (
        <div className="mt-4" />
      )}
      {children}
    </section>
  );
}

/**
 * What went wrong, in the words the route used.
 *
 * The API messages here are written for the person at the desk — "that card
 * already opens Nadia's record", "no face could be detected in the photo" —
 * so they are shown as they arrived rather than replaced with a generic
 * failure line. An expired session is the one case that is not retryable, and
 * it gets a way back in rather than a message.
 */
export function Failure({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError ? error.message : "Something went wrong saving this record.";
  const expired = error instanceof ApiError && error.status === 401;
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
      <TriangleAlert className="mt-0.5 size-5 shrink-0" />
      <div className="flex flex-col gap-2">
        <p className="first-letter:uppercase">{message}</p>
        {expired && (
          <Link href="/admin/login" className="font-medium underline underline-offset-4">
            Sign in again
          </Link>
        )}
      </div>
    </div>
  );
}
