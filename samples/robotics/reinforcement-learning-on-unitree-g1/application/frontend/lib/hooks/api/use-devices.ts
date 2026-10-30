// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { $api } from "@/lib/api"

export function useDevices() {
  return $api.useQuery("get", "/devices", undefined, { refetchInterval: 5000 })
}