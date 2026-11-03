// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QueueBoard } from "@/components/queue/queue-board";
import { moduleEnabled } from "@/modules/state";

/** /queue — the waiting-area display: every clinic's "now serving" number and who is waiting, numbers only. */
export const metadata: Metadata = {
  title: "Now serving",
  description: "Clinic queues for today, from kiosk check-ins.",
};

export default function QueuePage() {
  if (!moduleEnabled("queue")) notFound();
  return <QueueBoard />;
}
