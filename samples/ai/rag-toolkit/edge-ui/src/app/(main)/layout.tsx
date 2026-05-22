// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import GlobalStyles from '@mui/material/GlobalStyles';

import { MainNav } from '@/components/layout/main-nav';

interface LayoutProps {
    children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps): React.JSX.Element {
    return (
        <>
            <GlobalStyles
                styles={{
                    body: {
                        '--MainNav-height': '56px',
                        '--MainNav-zIndex': 1000,
                        '--SideNav-width': '280px',
                        '--SideNav-zIndex': 1100,
                        '--MobileNav-width': '320px',
                        '--MobileNav-zIndex': 1100,
                    },
                }}
            />
            <Box
                sx={{
                    bgcolor: 'var(--mui-palette-background-default)',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    minHeight: '100%',
                }}
            >
                <Box sx={{ display: 'flex', flex: '1 1 auto', flexDirection: 'column' }}>
                    <MainNav />
                    <main>
                        <Container maxWidth="md">
                            {children}
                        </Container>
                    </main>
                </Box>
            </Box>
        </>
    );
}