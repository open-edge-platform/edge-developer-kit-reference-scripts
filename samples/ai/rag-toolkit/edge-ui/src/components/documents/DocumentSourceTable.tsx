// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

// Framework
import React, { useContext, useMemo, useState, type MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Delete } from "@mui/icons-material";
import { CircularProgress, IconButton } from "@mui/material";
import { enqueueSnackbar } from "notistack";
import { ConfirmationContext } from "@/contexts/ConfirmationContext";
import { type TableHeaderProps } from "@/types/table";
import { useDeleteTextEmbeddingBySource } from "@/hooks/api-hooks/use-dataset-api";
import TableTemplate from "../common/TableTemplate";
import { sanitizeTextContent } from "@/utils/sanitization";

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
      onClick={(ev) => {
        handleDelete(ev, id);
      }}
    >
      <Delete />
    </IconButton>
  ) : (
    <CircularProgress size={20} />
  );
}

export default function DocumentSourceTable({
  data,
}: {
  data: string[];
}): React.JSX.Element {
  // Trust boundary: data is expected to be an array of strings from a trusted source (API/parent). 
  // Enhanced security: sanitize each source string to prevent XSS attacks.
  // This addresses potential DOM-based XSS vulnerabilities.
  const sanitizedData = useMemo(() => {
    if (!Array.isArray(data)) {
      console.warn('DocumentSourceTable: Expected array for data prop, received:', typeof data);
      return [];
    }
    
    return data
      .filter((d): d is string => typeof d === "string")
      .map(sanitizeTextContent)
      .filter((d): d is string => d !== "");
  }, [data]);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const { openConfirmationDialog } = useContext(ConfirmationContext);
  const deleteTextEmbeddingBySource = useDeleteTextEmbeddingBySource();
  const pathname = usePathname();
  const router = useRouter();

  const headers: TableHeaderProps[] = [
    {
      id: "source",
      label: "Source",
      sort: false,
      numeric: false,
    },
  ];

  // Memoize formattedData. Only uses sanitized, trusted data and local handlers.
  const formattedData = useMemo(() => {
    const handleDelete = (
      ev: MouseEvent<HTMLButtonElement>,
      id: string
    ): void => {
      ev.stopPropagation();
      openConfirmationDialog({
        title: "Delete Source",
        message: "Are you sure you want to delete?",
        onClick: () => {
          confirmDelete(id);
        },
      });
    };

    const confirmDelete = (id: string): void => {
      setDeletingIds((prev: string[]) => [...prev, id]);
      deleteTextEmbeddingBySource.mutate(
        { source: id },
        {
          onSuccess: (response: { status?: boolean }) => {
            if (response.status) {
              enqueueSnackbar(`Source deleted successfully.`, {
                variant: "success",
              });
            } else {
              enqueueSnackbar(
                "Failed to delete source. Please check with admin.",
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

    return sanitizedData.map((d: string) => {
      return {
        id: d,
        source: d,
        actions: (
          <DeleteButton
            id={d}
            isDeleting={deletingIds.some((source: string) => source === d)}
            handleDelete={handleDelete}
          />
        ),
      };
    });
  }, [sanitizedData, deleteTextEmbeddingBySource, deletingIds, openConfirmationDialog]);

  const handleRowClick = (id: string | number): void => {
    router.push(`${pathname}/${id}`);
  };

  return (
    <TableTemplate
      headers={headers}
      data={formattedData}
      enableActions
      rowClicked={handleRowClick}
      enablePagination
    />
  );
}
