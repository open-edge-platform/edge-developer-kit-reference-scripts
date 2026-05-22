// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { getPayload } from 'payload'
import { engines } from '@/engines/registry'
import type { Service } from '@/payload-types'

export async function getWorkloadModel(
  workloadType: Service['type'],
): Promise<string> {
  const payload = await getPayload({ config })
  const textGenerationDoc = await payload.find({
    collection: 'services',
    where: { type: { equals: workloadType } },
    limit: 1,
  })

  if (textGenerationDoc.totalDocs < 1)
    return Promise.reject(`No ${workloadType} workload found`)

  const textGenerationWorkload = textGenerationDoc.docs[0]
  const selectedEngine = engines[textGenerationWorkload.engine]
  return selectedEngine.getModelName(
    textGenerationWorkload.models.default,
    true,
  )
}
