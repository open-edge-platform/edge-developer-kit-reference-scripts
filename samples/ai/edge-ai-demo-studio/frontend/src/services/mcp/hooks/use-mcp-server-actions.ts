// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { toast } from 'sonner'
import { toastError } from '@/lib/browser/toast-error'
import type { McpServer } from '@/payload-types'
import {
  type McpServerInput,
  useCreateMcpServer,
  useDeleteMcpServer,
  useUpdateMcpServer,
} from './index'

/**
 * Server record actions with toasts. `add`, `update` and `remove` reject with the reason, so the
 * dialog that asked can stay open and show it.
 */
export function useMcpServerActions() {
  const { mutateAsync: create } = useCreateMcpServer()
  const { mutateAsync: update, mutate: patch } = useUpdateMcpServer()
  const { mutateAsync: destroy } = useDeleteMcpServer()

  return {
    add: async (server: McpServerInput) => {
      const saved = await create(server)
      toast.success(`Added ${server.name}`)
      return saved
    },
    update: async (id: number, data: Partial<McpServerInput>) => {
      const saved = await update({ id, data })
      toast.success(`Saved ${data.name ?? 'the server'}`)
      return saved
    },
    remove: async (server: McpServer) => {
      await destroy(server.id)
      toast.success(`Deleted ${server.name}`)
    },
    toggleDisabled: (server: McpServer) =>
      patch(
        { id: server.id, data: { disabled: !server.disabled } },
        {
          onSuccess: () =>
            toast.success(
              `MCP server ${server.disabled ? 'enabled' : 'disabled'}`,
            ),
          onError: toastError('Failed to toggle server status'),
        },
      ),
  }
}
