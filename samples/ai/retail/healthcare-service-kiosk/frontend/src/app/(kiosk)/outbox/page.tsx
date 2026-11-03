// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cmsMe } from "@/app/api/_lib/cms";
import { OutboxDesk } from "@/components/staff/outbox-desk";

/** /outbox — the SMS, emails and clinic notes this terminal sent, behind the same CMS admin session as /settings. */
export const metadata: Metadata = {
  title: "Outbox",
  description: "SMS, email and clinic notifications sent by this kiosk.",
  robots: { index: false, follow: false },
};

export default async function OutboxPage() {
  const staff = await cmsMe((await cookies()).toString());
  if (!staff) redirect("/admin/login?redirect=%2Foutbox");

  return <OutboxDesk staffEmail={staff.email} />;
}
