// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  enrollCitizen,
  searchCitizens,
  updateEnrollment,
  type CitizenSummary,
  type EnrollmentDraft,
} from "@/lib/api/enrollment";

/** Query keys for the registration desk's reads. */
export const staffKeys = {
  citizens: (q: string) => ["staff", "citizens", q] as const,
};

/**
 * Look somebody up in the register. An empty term is not an empty result —
 * the route answers it with the most recently enrolled citizens, which is who
 * a card is most often being issued to.
 */
export function useCitizenSearch(q: string) {
  return useQuery({
    queryKey: staffKeys.citizens(q),
    queryFn: () => searchCitizens(q),
    // A staff member typing a name expects the list under it to keep up, but
    // the register does not change between keystrokes.
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Enroll a citizen. No retry: a create that failed halfway is not a request
 * to send again — the route already unwound its own half-written state, and
 * a second attempt would be the staff member's decision, not the client's.
 */
export function useEnrollCitizen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { draft: EnrollmentDraft; nfcUid: string; portrait: Blob | null }) =>
      enrollCitizen(input.draft, input.nfcUid, input.portrait),
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff", "citizens"] }),
  });
}

/** Bind a card and/or a portrait to a citizen who is already registered. */
export function useUpdateEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; nfcUid?: string; portrait?: Blob | null }) =>
      updateEnrollment(input.id, { nfcUid: input.nfcUid, portrait: input.portrait }),
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff", "citizens"] }),
  });
}

export type { CitizenSummary, EnrollmentDraft };
