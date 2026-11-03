// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cmsMe } from "@/app/api/_lib/cms";
import { DemoVisitDesk } from "@/components/staff/demo-visit-desk";

/** /demo-visit — reset a patient's visit between demo runs, behind the CMS admin session. Linked from the admin nav only. */
export const metadata: Metadata = {
  title: "Demo reset",
  description: "Get a patient ready to walk a visit at the kiosk again: an appointment today, not checked in, a bill to pay.",
  robots: { index: false, follow: false },
};

export default async function DemoVisitPage() {
  const staff = await cmsMe((await cookies()).toString());
  if (!staff) redirect("/admin/login?redirect=%2Fdemo-visit");

  return <DemoVisitDesk staffEmail={staff.email} />;
}
