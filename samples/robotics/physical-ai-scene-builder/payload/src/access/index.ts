// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Access, FieldAccess } from 'payload';

/** Local app mode: Payload data is intentionally available without a session. */
export const publicAccess: Access = () => true;
export const publicFieldAccess: FieldAccess = () => true;
