// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { TakeawayProps } from "@/packs/malaysia/steps";
import { QueueTicket } from "@/components/queue/queue-ticket";

export default function CheckInTakeaway({ data }: TakeawayProps) {
  if (!data.queueNumber || !data.department) return null;
  return <QueueTicket queueNumber={data.queueNumber} departmentId={data.department} doctor={data.doctor} time={data.time} />;
}
