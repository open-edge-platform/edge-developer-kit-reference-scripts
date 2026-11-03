// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { FieldHook } from 'payload'
import { decryptField, encryptField } from '@/lib/settings/field-encryption'

/**
 * Hooks for a secret text field: encrypted at rest; a plaintext legacy value reads back as is and is
 * encrypted on its next save. Pair with `access: { read: () => false }` to keep it out of REST.
 */
export const encryptedFieldHooks: {
  beforeChange: FieldHook[]
  afterRead: FieldHook[]
} = {
  beforeChange: [({ value }) => encryptField(value ?? '')],
  afterRead: [({ value }) => decryptField(value ?? '')],
}
