// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Throws "<serviceName> is not added yet" while `apiBase` is unset; narrows it to string. */
export function requireApiBase(
  apiBase: string | null | undefined,
  serviceName: string,
): asserts apiBase is string {
  if (!apiBase) throw new Error(`${serviceName} is not added yet`)
}
