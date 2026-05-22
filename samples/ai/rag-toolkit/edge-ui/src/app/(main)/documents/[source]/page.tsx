// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Framework
import React from "react";
import { Box, Container, Stack, Typography } from "@mui/material";
import { getDatasetEmbeddingsAPI } from "@/api/datasets";
import BackButton from "@/components/common/BackButton";
import InfoTypography from "@/components/common/InfoTypography";
import DocumentChunkTable from "@/components/documents/chunks/ChunkTable";
import DynamicPagination from "@/components/common/DynamicPagination";
import { type DocumentProps } from "@/types/dataset";

export default async function DocumentChunkPage({
  params,
  searchParams,
}: {
  params: { source: string };
  searchParams: { page?: string; rows?: string };
}): Promise<React.JSX.Element> {
  const documentSource = params.source.replace(/%20/g, " ");

  const rowOptions = [5, 10, 50, 100];
  const currentPage = parseInt(searchParams.page ?? "1");
  const rowsPerPage = parseInt(searchParams.rows ?? rowOptions[0].toString());
  const { data: embeddings } = await getDatasetEmbeddingsAPI(
    currentPage,
    rowsPerPage,
    documentSource
  );
  const parentURL = `/documents?page=1&rows=5`;

  return (
    <Container maxWidth="md">
      <Box display="flex" flexDirection="column" height="93vh" sx={{ pt: 3 }}>
        <Stack spacing={3}>
          <Stack spacing={1} sx={{ alignItems: "center" }} direction="row">
            <BackButton url={parentURL} />
            <Typography variant="h5">{documentSource}</Typography>
          </Stack>
          <InfoTypography>Manage your document chunks here</InfoTypography>
          <DocumentChunkTable
            data={(embeddings as DocumentProps)?.doc_chunks ?? []}
          />
          <DynamicPagination
            rowsOption={rowOptions}
            count={(embeddings as DocumentProps)?.num_embeddings ?? 0}
          />
        </Stack>
      </Box>
    </Container>
  );
}
