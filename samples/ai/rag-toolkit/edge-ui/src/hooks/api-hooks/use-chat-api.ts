// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getModelIdAPI } from "@/api/chat";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

export function useGetModelID(endpoint?: string): UseQueryResult<string> {
    return useQuery({
        queryKey: ['models', endpoint],
        queryFn: async () => {
            const response = await getModelIdAPI();
            return (((response.data as Record<string, any[]>).data[0] as Record<string, any>).id as string) ?? null;
        }
    });
}