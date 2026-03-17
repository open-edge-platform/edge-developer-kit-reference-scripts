// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use server";

import { revalidateTag } from "next/cache";
import { FetchAPI } from "../utils/api";
import { constructURL } from "../utils/common";
import { type APIResponse } from "../types/api";

const API = new FetchAPI(`http://${process.env.NEXT_PUBLIC_LLM_API_URL ?? "localhost"}:${process.env.NEXT_PUBLIC_LLM_API_PORT ?? "8011"}`);

export const createTextEmbeddingsAPI = async (
  chunkSize: number,
  chunkOverlap: number,
  data: FormData
): Promise<APIResponse> => {
  const response = await API.post(
    `rag/text_embeddings?chunk_size=${chunkSize}&chunk_overlap=${chunkOverlap}`,
    data,
    { headers: {} }
  );
  if (response.status) {
    revalidateTag(`rag/text_embeddings`, {});
    revalidateTag(`rag/text_embedding_sources`, {});
  }
  return response;
};

export const getDatasetEmbeddingsAPI = async (
  page?: number,
  pageSize?: number,
  source?: string
): Promise<APIResponse> => {
  const url = `rag/text_embeddings`;
  const fullURL = source
    ? constructURL(url, page, pageSize, { source })
    : constructURL(url, page, pageSize);
  const response = await API.get(fullURL, { tags: [url] });
  return response;
};

export const getDatasetEmbeddingSourcesAPI = async (): Promise<APIResponse> => {
  const url = `rag/text_embedding_sources`;
  const response = await API.get(url, { tags: [url] });
  return response;
};

export const deleteTextEmbeddingByUUIDAPI = async (
  uuid: string
): Promise<APIResponse> => {
  const response = await API.delete(`rag/text_embeddings/${uuid}`);
  if (response.status) {
    revalidateTag(`rag/text_embeddings`, {});
  }
  return response;
};

export const deleteTextEmbeddingBySourceAPI = async (
  source: string
): Promise<APIResponse> => {
  const response = await API.delete(`rag/text_embeddings/source/${source}`);
  if (response.status) {
    revalidateTag(`rag/text_embedding`, {});
    revalidateTag(`rag/text_embedding_sources`, {});
  }
  return response;
};
