// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { NavItemConfig } from '@/types/nav';
import { paths } from '@/paths';

export const navItems = [...paths.main] satisfies NavItemConfig[];
