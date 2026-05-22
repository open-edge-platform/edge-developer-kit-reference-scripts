// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import React, { type ReactNode } from 'react';
import { Close } from '@mui/icons-material';
import { IconButton } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { enqueueSnackbar, SnackbarProvider, useSnackbar, type SnackbarKey } from 'notistack';

import { ConfirmationProvider } from '@/contexts/ConfirmationContext';
import { AudioPlayerProvider } from '@/contexts/AudioPlayerContext';

function SnackbarCloseButton({ snackbarKey }: { snackbarKey: SnackbarKey }): React.JSX.Element {
  const { closeSnackbar } = useSnackbar();
  return (
    <IconButton
      onClick={() => {
        closeSnackbar(snackbarKey);
      }}
    >
      <Close sx={{ color: (theme) => theme.palette.common.white }} />
    </IconButton>
  );
}

function SnackbarAction(snackbarKey: SnackbarKey): React.JSX.Element {
  return <SnackbarCloseButton snackbarKey={snackbarKey} />;
}

export default function Providers({ children }: { children: ReactNode }): React.JSX.Element {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        onError: (error) => {
          console.log(error);
          enqueueSnackbar('Error processing request. Please contact admin.', { variant: 'error' });
        },
      },
    },
  });

  return (
    <ConfirmationProvider>
      <SnackbarProvider action={SnackbarAction} autoHideDuration={3000}>
        <QueryClientProvider client={queryClient}>
          <AudioPlayerProvider>
            {children}
          </AudioPlayerProvider>
        </QueryClientProvider>
      </SnackbarProvider>
    </ConfirmationProvider>
  );
}
