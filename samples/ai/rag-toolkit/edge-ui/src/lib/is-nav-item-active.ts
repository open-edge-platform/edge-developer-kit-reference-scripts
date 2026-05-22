// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { NavItemConfig } from '@/types/nav';

export function isNavItemActive({
  disabled,
  external,
  href,
  matcher,
  pathname,
}: Pick<NavItemConfig, 'disabled' | 'external' | 'href' | 'matcher'> & { pathname: string }): boolean {
  if (disabled || external) {
    return false;
  }
  if (matcher) {
    if (matcher.type === 'startsWith') {
      return pathname.startsWith(matcher.href);
    } else if (matcher.type === 'equals') {
      return pathname === matcher.href;
    } else if (matcher.type === 'includes') {
      return pathname.includes(matcher.href);
    }

    return false;
  }

  return pathname === href;
}
