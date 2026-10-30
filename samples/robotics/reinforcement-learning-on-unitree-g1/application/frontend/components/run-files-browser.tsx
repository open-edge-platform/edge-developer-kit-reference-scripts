// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FileTreeBrowser } from "@/components/ui/file-tree-browser"
import type { Run } from "@/lib/api"
import { useRunFiles } from "@/lib/hooks/api/use-runs"

export function RunFilesBrowser({ run }: { run: Run }) {
  const filesQuery = useRunFiles(run.experiment, run.name)

  return (
    <FileTreeBrowser
      id={`run-${encodeURIComponent(run.id)}`}
      ariaLabel={`Files for ${run.name}`}
      files={filesQuery.data ?? []}
      isLoading={filesQuery.isLoading}
      isError={filesQuery.isError}
      refetch={filesQuery.refetch}
    />
  )
}
