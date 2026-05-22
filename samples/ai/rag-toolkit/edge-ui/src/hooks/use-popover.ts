// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as React from 'react';

export interface PopoverController<T> {
  anchorRef: React.MutableRefObject<T | null>;
  handleOpen: VoidFunction;
  handleClose: VoidFunction;
  handleToggle: VoidFunction;
  open: boolean;
}

export function usePopover<T = HTMLElement>(): PopoverController<T> {
  const anchorRef = React.useRef<T>(null);
  const [open, setOpen] = React.useState<boolean>(false);

  const handleOpen = React.useCallback(() => {
    setOpen(true);
  }, []);

  const handleClose = React.useCallback(() => {
    setOpen(false);
  }, []);

  const handleToggle = React.useCallback(() => {
    setOpen((prevState) => !prevState);
  }, []);

  return { anchorRef, handleClose, handleOpen, handleToggle, open };
}
