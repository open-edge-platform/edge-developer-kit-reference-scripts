// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cmsMe } from "@/app/api/_lib/cms";
import { SettingsDesk } from "@/components/staff/settings-desk";

/**
 * The terminal's settings — /settings.
 *
 * A staff screen like the registration desk, behind the same CMS admin
 * session: it edits this terminal's config.yaml (the services it talks to,
 * the peripherals, the demo timing) and restarts the kiosk to apply. See
 * src/app/api/_lib/settings.ts.
 */
export const metadata: Metadata = {
  title: "Kiosk settings",
  description: "Edit this terminal's config.yaml and restart the kiosk to apply.",
};

export default async function SettingsPage() {
  const staff = await cmsMe((await cookies()).toString());
  if (!staff) redirect("/admin/login?redirect=%2Fsettings");

  return <SettingsDesk staffEmail={staff.email} />;
}
