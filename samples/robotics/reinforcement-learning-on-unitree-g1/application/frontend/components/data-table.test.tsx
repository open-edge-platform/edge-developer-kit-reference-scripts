// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { DataTable, type DataTableColumn } from "@/components/data-table"

type Row = { id: string; name: string }

afterEach(cleanup)

const columns: DataTableColumn<Row>[] = [
  { key: "name", header: "Name", cell: (row) => row.name },
]

function renderTable(rows: Row[]) {
  return render(
    <DataTable
      ariaLabel="Sample rows"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      getRowLabel={(row) => row.name}
      getActions={() => [{ label: "Delete", onSelect: () => undefined }]}
      emptyMessage="No rows"
    />,
  )
}

describe("DataTable", () => {
  it("limits each page to ten rows and navigates to the remaining rows", () => {
    const rows = Array.from({ length: 11 }, (_, index) => ({
      id: String(index),
      name: `Row ${index + 1}`,
    }))
    renderTable(rows)

    expect(screen.getAllByRole("row")).toHaveLength(11)
    expect(screen.getByText("Showing 1-10 of 11")).toBeTruthy()
    expect(screen.getByText("Page 1 of 2")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Next page" }))

    expect(screen.getAllByRole("row")).toHaveLength(2)
    expect(screen.getByText("Row 11")).toBeTruthy()
    expect(screen.getByText("Showing 11-11 of 11")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows the empty message without pagination for an empty list", () => {
    renderTable([])

    expect(screen.getByText("No rows")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull()
  })

  it("runs the selected row action from the shared ellipsis menu", async () => {
    const rows = [{ id: "row-1", name: "First row" }]
    let selectedRow: Row | null = null
    render(
      <DataTable
        ariaLabel="Sample rows"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.name}
        getActions={() => [{ label: "Delete", onSelect: (selected) => { selectedRow = selected } }]}
        emptyMessage="No rows"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "More actions for First row" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }))

    expect(selectedRow).toEqual(rows[0])
  })

  it("clamps navigation when rows shrink on a later page", () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: String(index),
      name: `Row ${index + 1}`,
    }))
    const { rerender } = renderTable(rows)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(screen.getByText("Page 3 of 3")).toBeTruthy()

    const smallerRows = rows.slice(0, 11)
    rerender(
      <DataTable
        ariaLabel="Sample rows"
        columns={columns}
        rows={smallerRows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.name}
        getActions={() => [{ label: "Delete", onSelect: () => undefined }]}
        emptyMessage="No rows"
      />,
    )
    expect(screen.getByText("Page 2 of 2")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }))
    expect(screen.getByText("Page 1 of 2")).toBeTruthy()
    expect(screen.getByText("Showing 1-10 of 11")).toBeTruthy()
  })
})