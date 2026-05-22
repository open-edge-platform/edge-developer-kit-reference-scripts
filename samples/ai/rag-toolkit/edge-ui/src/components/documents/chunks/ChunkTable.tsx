// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

// Framework
import React, { useContext, useMemo, useState, type MouseEvent } from "react";
import { Delete } from "@mui/icons-material";
import { CircularProgress, IconButton } from "@mui/material";
import { enqueueSnackbar } from "notistack";
import { ConfirmationContext } from "@/contexts/ConfirmationContext";
import { type TableHeaderProps } from "@/types/table";
import TableTemplate from "@/components/common/TableTemplate";
import { type ChunkProps } from "@/types/dataset";
import { useDeleteTextEmbeddingByUUID } from "@/hooks/api-hooks/use-dataset-api";
import { validateAndSanitizeChunk } from "@/utils/sanitization";


function DeleteButton({
  id,
  isDeleting,
  handleDelete,
}: {
  id: string;
  isDeleting: boolean;
  handleDelete: (ev: MouseEvent<HTMLButtonElement>, id: string) => void;
}): React.JSX.Element {
  return !isDeleting ? (
    <IconButton
      color="error"
      onClick={(ev: React.MouseEvent<HTMLButtonElement>) => {
        handleDelete(ev, id);
      }}
    >
      <Delete />
    </IconButton>
  ) : (
    <CircularProgress size={20} />
  );
}

export default function DocumentChunkTable({
  data,
}: {
  data: ChunkProps[];
}): React.JSX.Element {
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const { openConfirmationDialog } = useContext(ConfirmationContext);
  const deleteTextEmbeddingByUUID = useDeleteTextEmbeddingByUUID();

  const headers: TableHeaderProps[] = [
    {
      id: "chunk",
      label: "Chunk",
      sort: false,
      numeric: false,
    },
    {
      id: "page",
      label: "Page",
      sort: false,
      numeric: false,
    },
  ];

  // Trust boundary: The `data` prop is assumed to be provided by a trusted parent component.
  // However, to prevent DOM-based XSS attacks, we validate and sanitize all data before processing.
  // This addresses CID 2372868: DOM-based cross-site scripting (DOM_XSS)
  const sanitizedAndValidatedData = useMemo(() => {
    if (!Array.isArray(data)) {
      console.warn('DocumentChunkTable: Expected array for data prop, received:', typeof data);
      return [];
    }

    return data
      .map(validateAndSanitizeChunk)
      .filter((chunk): chunk is NonNullable<typeof chunk> => chunk !== null);
  }, [data]);

  const formattedData = useMemo(() => {
    const handleDelete = (
      ev: MouseEvent<HTMLButtonElement>,
      id: string
    ): void => {
      ev.stopPropagation();
      openConfirmationDialog({
        title: "Delete Embedding",
        message: "Are you sure you want to delete?",
        onClick: () => {
          confirmDelete(id);
        },
      });
    };

    const confirmDelete = (id: string): void => {
      setDeletingIds((prev: string[]) => [...prev, id]);
      deleteTextEmbeddingByUUID.mutate(
        { uuid: id },
        {
          onSuccess: (response: { status: boolean }) => {
            if (response.status) {
              enqueueSnackbar(`Embedding deleted successfully.`, {
                variant: "success",
              });
            } else {
              enqueueSnackbar(
                "Failed to delete embedding. Please check with admin.",
                { variant: "error" }
              );
            }
          },
          onSettled: () => {
            setDeletingIds((prev: string[]) => prev.filter((p: string) => p !== id));
          },
        }
      );
    };

    // Process only sanitized and validated chunk items
    return sanitizedAndValidatedData.map((d: { ids: string; chunk: string; source: string; page: number }) => {
      return {
        ...d,
        id: d.ids,
        actions: (
          <DeleteButton
            id={d.ids}
            isDeleting={deletingIds.some((id: string) => id === d.ids)}
            handleDelete={handleDelete}
          />
        ),
      };
    });
  }, [sanitizedAndValidatedData, deleteTextEmbeddingByUUID, deletingIds, openConfirmationDialog]);

  return <TableTemplate headers={headers} data={formattedData} enableActions />;
}
