// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type ReactElement, type ReactNode } from 'react';

export interface TabsProps {
  children?: ReactElement | ReactNode | string;
  value: string | number;
  index: number;
}
