// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

// Framework import
import * as React from 'react';
import { AppBar, Container, MenuItem, Stack, Toolbar, Typography } from '@mui/material';

import { paths } from '@/paths';

import { usePathname, useRouter } from 'next/navigation';
import Icon from './nav-icons';
import { isNavItemActive } from '@/lib/is-nav-item-active';

export function MainNav(): React.JSX.Element {
  const router = useRouter()
  const handleNavigate = (href: string): void => {
    router.push(href)
  };
  const pathname = usePathname()

  return (
    <AppBar position="static" sx={theme => ({
      '--NavItem-color': 'var(--mui-palette-common-white)',
      '--NavItem-hover-background': 'rgba(255, 255, 255, 0.04)',
      '--NavItem-active-background': 'var(--mui-palette-common-white)',
      '--NavItem-active-color': 'var(--mui-palette-primary-contrastText)',
      '--NavItem-disabled-color': 'var(--mui-palette-neutral-500)',
      '--NavItem-icon-color': 'var(--mui-palette-common-white)',
      '--NavItem-icon-active-color': 'var(--mui-palette-primary-contrastText)',
      '--NavItem-icon-disabled-color': 'var(--mui-palette-neutral-600)',
      backgroundColor: theme.palette.primary.main
    })}>
      <Container maxWidth="xl">
        <Toolbar disableGutters>
          <MenuItem key="home" onClick={() => { handleNavigate("/"); }}>
            <Typography variant='h6' fontWeight="bold" textAlign="center">LLM On Edge</Typography>
          </MenuItem>
          {paths.main.map((path) => {
            const active = isNavItemActive({ ...path, pathname })
            return (
              <MenuItem key={path.key} onClick={() => { handleNavigate(path.href); }}>
                <Stack direction="row" justifyContent="center" alignItems="center" gap=".2rem">
                  <Icon iconName={path.icon} active={active} />
                  <Typography variant='body1' fontWeight={600} textAlign="center">{path.title}</Typography>
                </Stack>
              </MenuItem>
            )
          })}
        </Toolbar>
      </Container>
    </AppBar>
  );
}
