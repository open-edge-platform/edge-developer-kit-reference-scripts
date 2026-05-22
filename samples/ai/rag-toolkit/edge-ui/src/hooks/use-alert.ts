// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { enqueueSnackbar } from 'notistack';

export function alert(message: string): void {
  enqueueSnackbar(message, { variant: 'error' });
}
