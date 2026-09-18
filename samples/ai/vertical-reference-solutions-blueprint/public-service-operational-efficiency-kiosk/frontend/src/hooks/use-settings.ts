// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getSettings,
  restartKiosk,
  saveSettings,
  saveSettingsText,
  type SettingsSnapshot,
} from "@/lib/api/settings";

const KEY = ["staff", "settings"] as const;

export function useSettings() {
  return useQuery({ queryKey: KEY, queryFn: getSettings, staleTime: 0, retry: false });
}

/** Both saves replace the cached snapshot with the one the route reads back
 *  after writing, so the form re-seeds from what is really in the file. */
export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { values: Record<string, string> } | { text: string }) =>
      "text" in input ? saveSettingsText(input.text) : saveSettings(input.values),
    retry: false,
    onSuccess: (snapshot: SettingsSnapshot) => queryClient.setQueryData(KEY, snapshot),
  });
}

export function useRestartKiosk() {
  return useMutation({ mutationFn: restartKiosk, retry: false });
}
