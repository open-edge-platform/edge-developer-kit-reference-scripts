// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cmsMe } from "@/app/api/_lib/cms";
import { MockDocumentsDesk } from "@/components/staff/mock-documents-desk";

/** /mock-documents — test paperwork for a registered citizen, behind the same CMS admin session as /settings. */
export const metadata: Metadata = {
  title: "Mock documents",
  description: "Generate and download a citizen's genuine and tampered test documents.",
  robots: { index: false, follow: false },
};

export default async function MockDocumentsPage() {
  const staff = await cmsMe((await cookies()).toString());
  if (!staff) redirect("/admin/login?redirect=%2Fmock-documents");

  return <MockDocumentsDesk staffEmail={staff.email} />;
}
