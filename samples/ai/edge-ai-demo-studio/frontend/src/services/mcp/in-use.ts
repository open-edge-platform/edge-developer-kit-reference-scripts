// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMcpServers } from './hooks'

/** MCP Manager is in use once a server is registered: the sidebar lists it. */
export function useInUse(): boolean {
  const { data: servers } = useMcpServers()
  return Boolean(servers?.length)
}
