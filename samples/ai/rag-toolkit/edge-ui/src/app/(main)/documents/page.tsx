// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use server";

// Framework
import React from "react";
import { Box, Container, Stack, Typography } from "@mui/material";
import { getDatasetEmbeddingSourcesAPI } from "@/api/datasets";
import InfoTypography from "@/components/common/InfoTypography";
import DocumentSourceHeader from "@/components/documents/DocumentSourceHeader";
import DocumentSourceTable from "@/components/documents/DocumentSourceTable";

export default async function DocumentsPage(): Promise<React.JSX.Element> {
  const { status, data: source } = await getDatasetEmbeddingSourcesAPI();

  return (
    <Container maxWidth="md" >
      <Box
        display="flex"
        flexDirection="column"
        height="93vh"
        sx={{ pt: 3 }}
      >
        <Stack spacing={3}>
          <Stack spacing={1} sx={{ flex: "1 1 auto" }}>
            <Typography variant="h4">Documents</Typography>
          </Stack>
          <InfoTypography>
            Create your vector database by uploading your documents.
          </InfoTypography>
          <DocumentSourceHeader />
          <DocumentSourceTable data={status ? source : []} />
        </Stack>
      </Box>
    </Container>
  );
}
