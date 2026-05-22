// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export const paths = {
  home: '/main',
  main: [
    {
      key: 'chat',
      title: 'Chat',
      href: '/',
      icon: 'chat',
      matcher: { type: 'equals', href: '/' }, // Type equals/startsWith/include/
    },
    {
      key: 'documents',
      title: 'Documents',
      href: 'documents',
      icon: 'article',
      matcher: { type: 'equals', href: '/documents' }, // Type equals/startsWith/include/
    },
    {
      key: 'settings',
      title: 'Settings',
      href: 'settings',
      icon: 'settings',
      matcher: { type: 'equals', href: '/settings' }, // Type equals/startsWith/include/
    },
  ],
  errors: { notFound: '/errors/not-found' },
} as const;
