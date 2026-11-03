// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { formatMoney } from "@/lib/format";
import { CURRENCY } from "@/app/api/_lib/registry";
import { done } from "@/app/api/_lib/flows/plan";
import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { liveRecord } from "@/app/api/_lib/ledger";
import { resultMessage } from "@/services/shared/result";
import { prescriptionsResult } from "./prescriptions";

export const chain: ChainSpec = {
  application: async (ctx) => {
    const record = await liveRecord(ctx.documentNumber);
    if (record.prescriptions.length === 0) {
      return done("You have no active prescriptions on record.");
    }
    return done(resultMessage(prescriptionsResult(record, (amount) => formatMoney(amount, CURRENCY))));
  },
};
