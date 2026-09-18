// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cmsMe } from "@/app/api/_lib/cms";
import { EnrollDesk } from "@/components/staff/enroll-desk";

/**
 * The registration desk — /enroll.
 *
 * A staff screen, not a kiosk one: it belongs to the person behind the
 * counter registering somebody, and it sits outside the kiosk flow so a
 * citizen at the terminal can never walk into it. The gate is the CMS admin
 * session, checked here before anything renders and again on every route the
 * page calls, because a page that only hides itself is not a gate.
 *
 * It lives here rather than inside Payload's own admin because of the two
 * things it does that a CMS form cannot: hold a live camera preview while
 * somebody is framed for their portrait, and wait on the PC/SC reader for a
 * card to be presented. Everything it writes is an ordinary registry row,
 * visible and correctable at /admin.
 */
export const metadata: Metadata = {
  title: "Registration desk",
  description: "Register a citizen with their portrait and NFC card.",
};

export default async function EnrollPage() {
  const staff = await cmsMe((await cookies()).toString());
  if (!staff) redirect("/admin/login?redirect=%2Fenroll");

  return <EnrollDesk staffEmail={staff.email} />;
}
