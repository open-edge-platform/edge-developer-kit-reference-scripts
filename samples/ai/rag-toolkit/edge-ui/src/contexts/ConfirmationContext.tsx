// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import React, { createContext, useCallback, useState, type ReactNode } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider } from '@mui/material';

type ConfirmationTypes = 'error' | 'inherit' | 'primary' | 'secondary' | 'success' | 'info' | 'warning';
interface ConfirmationContextProps {
  openConfirmationDialog: (data: {
    title?: string;
    message?: string;
    onClick: (args?: any) => void;
    type?: ConfirmationTypes;
  }) => void;
  updateOpen: (status: boolean) => void;
}

export const ConfirmationContext = createContext<ConfirmationContextProps>({} as ConfirmationContextProps);

export function ConfirmationProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [dialogDetails, setDialogDetails] = useState<{
    title: string;
    message: string;
    type: ConfirmationTypes;
    onClick: (args?: any) => void;
  }>({
    title: 'Confirmation',
    message: 'Are you sure you want to delete?',
    type: 'error',
    onClick: () => {},
  });

  const openConfirmationDialog = useCallback(
    (data: {
      title?: string;
      message?: string;
      onClick: VoidFunction;
      type?: 'error' | 'inherit' | 'primary' | 'secondary' | 'success' | 'info' | 'warning';
    }) => {
      setDialogDetails((prev) => {
        return { ...prev, ...data, type: data.type ?? 'error' };
      });
      setOpen(true);
    },
    []
  );

  const updateOpen = (status: boolean): void => {
    setOpen(status);
  };

  return (
    <ConfirmationContext.Provider value={{ openConfirmationDialog, updateOpen }}>
      {children}

      <Dialog
        maxWidth="sm"
        fullWidth
        open={open}
        onClose={() => {
          updateOpen(false);
        }}
        sx={{ p: 3 }}
      >
        {open ? (
          <>
            <DialogTitle sx={{ textAlign: 'center', fontWeight: 'bold' }}>{dialogDetails.title}</DialogTitle>
            <Divider />
            <DialogContent>
              <DialogContentText sx={{ textAlign: 'center' }}>{dialogDetails.message}</DialogContentText>
            </DialogContent>
            <DialogActions sx={{ display: 'flex', justifyContent: 'space-evenly', alignItems: 'center' }}>
              <Button
                color={dialogDetails.type ?? 'error'}
                variant="contained"
                size="medium"
                onClick={() => {
                  dialogDetails.onClick();
                  updateOpen(false);
                }}
              >
                Confirm
              </Button>
              <Button
                onClick={() => {
                  updateOpen(false);
                }}
                color="primary"
                variant="outlined"
              >
                Cancel
              </Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>
    </ConfirmationContext.Provider>
  );
}
