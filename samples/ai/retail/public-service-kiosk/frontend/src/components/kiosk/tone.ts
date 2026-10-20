// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Semantic colouring shared by notices, status pills and document cards.
 * `info` is neutral explanation; the other three report a finding about the
 * applicant's record — good news, a caveat, or a blocker.
 */
export type Tone = "info" | "warning" | "danger" | "success";

/** Tinted background plus matching text colour. */
export const TONE_SURFACE: Record<Tone, string> = {
  info: "bg-accent text-ink",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
  success: "bg-success/10 text-success",
};
