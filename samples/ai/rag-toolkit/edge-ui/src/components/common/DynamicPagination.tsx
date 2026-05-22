// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Stack, TablePagination } from '@mui/material';

export default function DynamicPagination({
  count,
  rowsOption = [20, 50, 100],
}: {
  count: number;
  rowsOption?: number[];
}): React.JSX.Element {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(rowsOption[0]);

  const onRowsPerPageChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setRowsPerPage(Number(e.target.value));
    setPage(1);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    params.set('page', page.toString());
    params.set('rows', rowsPerPage.toString());
    router.replace(`${pathname}?${params.toString()}`);
  }, [page, rowsPerPage, pathname, searchParams, router]);

  return (
    <Stack>
      <TablePagination
        rowsPerPageOptions={rowsOption}
        component="div"
        count={count}
        rowsPerPage={rowsPerPage}
        page={page - 1}
        onPageChange={(_, pageNumber) => {
          setPage(pageNumber + 1);
        }}
        onRowsPerPageChange={(e) => {
          onRowsPerPageChange(e);
        }}
      />
    </Stack>
  );
}
