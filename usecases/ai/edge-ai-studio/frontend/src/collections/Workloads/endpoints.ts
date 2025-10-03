// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { PayloadRequest } from 'payload'

export const WorkloadEndpoints = [
  {
    path: '/status',
    method: 'get' as const,
    handler: async (req: PayloadRequest) => {
      const query = req.query
      const payload = req.payload

      // Get workloads from database
      const workloads = await payload.find({
        collection: 'workloads',
        pagination: false,
        select: {
          id: true,
          type: true,
          status: true,
        },
        ...query,
      })

      // Return current status
      return Response.json(
        workloads.docs.map((workload) => ({
          id: workload.id,
          type: workload.type,
          status: workload.status,
        })),
      )
    },
  },
]
