// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Components } from '@mui/material/styles';

import type { Theme } from '../types';

export const MuiStack = { defaultProps: { useFlexGap: true } } satisfies Components<Theme>['MuiStack'];
