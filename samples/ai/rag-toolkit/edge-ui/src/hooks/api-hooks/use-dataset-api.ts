// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { type APIResponse } from "../../types/api";
import { type CreateTextBeddingsProps } from "@/types/dataset";
import { createTextEmbeddingsAPI, deleteTextEmbeddingBySourceAPI, deleteTextEmbeddingByUUIDAPI } from "@/api/datasets";

export const useCreateTextEmbeddings = (): UseMutationResult<
  APIResponse,
  Error,
  CreateTextBeddingsProps
> => {
  return useMutation({
    mutationFn: async ({
      chunkSize,
      chunkOverlap,
      data,
    }: CreateTextBeddingsProps) => {
      return await createTextEmbeddingsAPI(chunkSize, chunkOverlap, data);
    },
  });
};

export const useDeleteTextEmbeddingByUUID = (): UseMutationResult<
  APIResponse,
  Error,
  { uuid: string }
> => {
  return useMutation({
    mutationFn: async ({ uuid }: { uuid: string }) => {
      return await deleteTextEmbeddingByUUIDAPI(uuid);
    },
  });
};

export const useDeleteTextEmbeddingBySource = (): UseMutationResult<
  APIResponse,
  Error,
  { source: string }
> => {
  return useMutation({
    mutationFn: async ({ source }: { source: string }) => {
      return await deleteTextEmbeddingBySourceAPI(source);
    },
  });
};
