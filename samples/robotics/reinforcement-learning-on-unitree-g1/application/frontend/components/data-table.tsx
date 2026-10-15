"use client"

import { useState, type ReactNode } from "react"
import { Menu } from "@base-ui/react/menu"
import { ChevronLeft, ChevronRight, Ellipsis } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const PAGE_SIZE = 10

export type DataTableColumn<Row> = {
  key: string
  header: ReactNode
  cell: (row: Row, index: number) => ReactNode
  className?: string
}

export type DataTableAction<Row> = {
  label: string
  icon?: ReactNode
  destructive?: boolean
  disabled?: boolean
  onSelect: (row: Row) => void
}

type DataTableProps<Row> = {
  ariaLabel: string
  columns: DataTableColumn<Row>[]
  rows: Row[]
  getRowId: (row: Row) => string
  getRowLabel: (row: Row) => string
  getActions: (row: Row) => DataTableAction<Row>[]
  emptyMessage: string
  onRowClick?: (row: Row) => void
  selectedRowId?: string | null
}

export function DataTable<Row>({
  ariaLabel,
  columns,
  rows,
  getRowId,
  getRowLabel,
  getActions,
  emptyMessage,
  onRowClick,
  selectedRowId,
}: DataTableProps<Row>) {
  const [pageIndex, setPageIndex] = useState(0)
  const pageCount = Math.ceil(rows.length / PAGE_SIZE)
  const currentPage = Math.min(pageIndex, Math.max(pageCount - 1, 0))
  const startIndex = currentPage * PAGE_SIZE
  const visibleRows = rows.slice(startIndex, startIndex + PAGE_SIZE)

  return (
    <div className="overflow-hidden border border-[#dce3dc] bg-white">
      <Table aria-label={ariaLabel}>
        <TableHeader>
          <TableRow className="bg-[#f5f7f2] hover:bg-[#f5f7f2]">
            {columns.map((column) => (
              <TableHead key={column.key} className={column.className}>{column.header}</TableHead>
            ))}
            <TableHead className="w-10 px-2 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length + 1} className="h-36 text-center text-sm text-[#849084]">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : visibleRows.map((row, rowIndex) => {
            const rowId = getRowId(row)
            const actions = getActions(row)

            return (
              <TableRow key={rowId} data-state={selectedRowId === rowId ? "selected" : undefined}>
                {columns.map((column, columnIndex) => (
                  <TableCell key={column.key} className={column.className}>
                    {onRowClick && columnIndex === 0 ? (
                      <button
                        type="button"
                        className="w-full min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#7da35c] focus-visible:ring-offset-2"
                        onClick={() => onRowClick(row)}
                      >
                        {column.cell(row, startIndex + rowIndex)}
                      </button>
                    ) : column.cell(row, startIndex + rowIndex)}
                  </TableCell>
                ))}
                <TableCell className="w-10 px-2 text-right">
                  <Menu.Root>
                    <Menu.Trigger
                      aria-label={`More actions for ${getRowLabel(row)}`}
                      title="More actions"
                      className="inline-grid size-7 place-items-center rounded text-[#758076] hover:bg-[#edf2e9] hover:text-[#17251a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7da35c]"
                    >
                      <Ellipsis size={16} />
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50 outline-none">
                        <Menu.Popup className="min-w-40 border border-[#dce3dc] bg-white p-1 text-sm text-[#263329] shadow-lg outline-none">
                          {actions.map((action) => (
                            <Menu.Item
                              key={action.label}
                              disabled={action.disabled}
                              onClick={() => action.onSelect(row)}
                              className={`flex h-8 cursor-pointer items-center gap-2 px-2 text-xs outline-none data-[highlighted]:bg-[#f1f7e9] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 ${action.destructive ? "text-[#a33f2a] data-[highlighted]:bg-[#fff0e9]" : "text-[#344a36]"}`}
                            >
                              {action.icon}
                              {action.label}
                            </Menu.Item>
                          ))}
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.Root>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {rows.length > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e8ece5] px-3 py-2">
          <p className="font-mono text-[10px] text-[#7c887d]">
            {startIndex + 1}-{Math.min(startIndex + PAGE_SIZE, rows.length)} of {rows.length}
          </p>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-[#7c887d]">Page {currentPage + 1} of {pageCount}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous page"
              disabled={currentPage === 0}
              onClick={() => setPageIndex(Math.max(currentPage - 1, 0))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next page"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPageIndex(Math.min(currentPage + 1, pageCount - 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}