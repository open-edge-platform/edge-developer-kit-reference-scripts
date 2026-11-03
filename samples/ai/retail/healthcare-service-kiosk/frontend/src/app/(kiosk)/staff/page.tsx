// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cmsMe } from "@/app/api/_lib/cms";
import { StaffHub } from "@/components/staff/staff-hub";

/** /staff — the staff pages in one list, behind the same CMS admin session as /enroll and /settings. */
export const metadata: Metadata = {
  title: "Staff pages",
  description: "Registration desk, kiosk settings and the CMS, for hospital staff.",
  robots: { index: false, follow: false },
};

export default async function StaffPage() {
  const staff = await cmsMe((await cookies()).toString());
  if (!staff) redirect("/admin/login?redirect=%2Fstaff");

  return <StaffHub staffEmail={staff.email} />;
}
