// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ComponentProps } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** The server table's frame, shared by the loaded list and its skeleton. */
export function ServerTable({ children, ...props }: ComponentProps<'div'>) {
  return (
    <div className="rounded-lg border" {...props}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <span className="sr-only">Tools</span>
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>Availability</TableHead>
            <TableHead>Tools</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  )
}

const SKELETON_ROWS = [0, 1, 2]

/** The table while the list loads, so it does not jump when it arrives. */
export function ServerTableSkeleton() {
  return (
    <ServerTable aria-busy="true" aria-label="Loading MCP servers">
      {SKELETON_ROWS.map((i) => (
        <TableRow key={i} aria-hidden="true">
          <TableCell className="w-8 px-2">
            <Skeleton className="size-4" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-28" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-48" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-20 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-12 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-9 rounded-full" />
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-10" />
              <Skeleton className="h-8 w-10" />
            </div>
          </TableCell>
        </TableRow>
      ))}
    </ServerTable>
  )
}
