// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

// Framework
import React from "react";
import { Add } from "@mui/icons-material";
import { Box, IconButton, Stack } from "@mui/material";
import { useDisclosure } from "@/hooks/use-disclosure";
import AddDocumentDialog from "./dialogs/AddDocumentDialog";

export default function DocumentSourceHeader(): React.JSX.Element {
  const { isOpen, onClose, onOpenChange } = useDisclosure();
  return (
    <>
      <Stack direction="row" justifyContent="flex-end">
        <Box>
          <IconButton
            onClick={() => {
              onOpenChange(true);
            }}
            sx={{
              backgroundColor: "primary.main",
              color: "white",
              "&:hover": { backgroundColor: "primary.main", opacity: "0.9" },
            }}
          >
            <Add sx={{ fontSize: "var(--icon-fontSize-md)" }} />
          </IconButton>
        </Box>
      </Stack>
      <AddDocumentDialog isOpen={isOpen} onClose={onClose} />
    </>
  );
}
