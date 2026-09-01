// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { CATEGORIES } from "@/services";
import { delay } from "../_lib/http";

export async function GET() {
  await delay(200);
  return Response.json({ categories: CATEGORIES });
}
