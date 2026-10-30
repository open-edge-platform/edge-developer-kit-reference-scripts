// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}