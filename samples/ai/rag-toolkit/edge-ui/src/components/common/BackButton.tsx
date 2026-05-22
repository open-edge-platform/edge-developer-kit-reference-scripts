// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import type React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from '@mui/icons-material';
import { IconButton } from '@mui/material';

export default function BackButton({ url }: { url: string }): React.JSX.Element {
  const router = useRouter();
  const handleBackClicked = (): void => {
    router.push(url);
  };
  return (
    <IconButton onClick={handleBackClicked}>
      <ChevronLeft />
    </IconButton>
  );
}
