// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getPayload } from 'payload';

export async function script(config) {
  const payload = await getPayload({ config });
  await payload.destroy();
}
