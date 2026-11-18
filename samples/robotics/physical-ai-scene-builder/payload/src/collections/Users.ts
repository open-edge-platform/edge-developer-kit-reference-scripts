// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload';

const denyAccess = () => false;

/** Payload framework collection only; product APIs do not use user identity. */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    hidden: true,
    useAsTitle: 'email',
  },
  access: {
    create: denyAccess,
    read: denyAccess,
    update: denyAccess,
    delete: denyAccess,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
    },
  ],
};
