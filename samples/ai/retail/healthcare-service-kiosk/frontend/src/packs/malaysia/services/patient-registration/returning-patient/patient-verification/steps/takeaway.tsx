// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { QueueTicket } from "@/components/queue/queue-ticket";
import type { TakeawayProps } from "@/packs/malaysia/steps";

export default function VerificationTakeaway({ data }: TakeawayProps) {
  if (!data.queueNumber || !data.department) return null;
  return <QueueTicket queueNumber={data.queueNumber} departmentId={data.department} />;
}
