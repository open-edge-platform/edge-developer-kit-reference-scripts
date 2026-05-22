// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Typography } from '@mui/material';

export default function InfoTypography({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Box
      sx={{
        width: '100%',
        borderRadius: `10px`,
        backgroundColor: 'grey.100',
        padding: '16px',
      }}
    >
      <Typography variant="body2">{children}</Typography>
    </Box>
  );
}
