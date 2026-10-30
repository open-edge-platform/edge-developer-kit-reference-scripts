// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { usePathnameMock } = vi.hoisted(() => ({ usePathnameMock: vi.fn() }))

vi.mock("next/navigation", () => ({ usePathname: usePathnameMock }))

import { AppProviders, AppShell } from "./providers"

function QueryClientProbe({ clients }: { clients: QueryClient[] }) {
  clients.push(useQueryClient())
  return null
}

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe("AppProviders", () => {
  it("reuses the browser query client across provider mounts", () => {
    const clients: QueryClient[] = []

    render(<AppProviders><QueryClientProbe clients={clients} /></AppProviders>)
    render(<AppProviders><QueryClientProbe clients={clients} /></AppProviders>)

    expect(clients).toHaveLength(2)
    expect(clients[0]).toBe(clients[1])
    expect(clients[0].getDefaultOptions()).toEqual({
      queries: { retry: false },
      mutations: { retry: false },
    })
  })

  describe("AppShell", () => {
    beforeEach(() => {
      window.localStorage.removeItem("theme")
      vi.stubGlobal("matchMedia", (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: () => true,
      }))
    })

    it.each([
      { pathname: "/", label: "Library" },
      { pathname: "/runs", label: "Training Runs" },
      { pathname: "/jobs", label: "Jobs" },
    ])("preserves navigation and providers for $pathname", ({ pathname, label }) => {
      usePathnameMock.mockReturnValue(pathname)
      const clients: QueryClient[] = []
      render(
        <AppShell>
          <div data-testid="page-content">Page content</div>
          <QueryClientProbe clients={clients} />
        </AppShell>,
      )

      expect(screen.getByRole("banner").nextElementSibling).toBe(screen.getByTestId("page-content"))
      for (const link of screen.getAllByRole("link", { name: label })) {
        expect(link.getAttribute("aria-current")).toBe("page")
      }
      for (const link of screen.getAllByRole("link")) {
        const expected = link.getAttribute("href") === pathname ? "page" : null
        expect(link.getAttribute("aria-current")).toBe(expected)
      }
      expect(clients).toHaveLength(1)
      expect(clients[0].getDefaultOptions().queries?.retry).toBe(false)
    })

    it("preserves the theme hotkey without intercepting text input", () => {
      usePathnameMock.mockReturnValue("/")
      render(<AppShell><input aria-label="Run label" /></AppShell>)

      expect(document.documentElement.classList.contains("light")).toBe(true)
      fireEvent.keyDown(window, { key: "d" })
      expect(document.documentElement.classList.contains("dark")).toBe(true)
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Run label" }), { key: "d" })
      expect(document.documentElement.classList.contains("dark")).toBe(true)
    })
  })

  it("creates an isolated query client for each server render", () => {
    vi.stubGlobal("window", undefined)
    const clients: QueryClient[] = []

    renderToString(<AppProviders><QueryClientProbe clients={clients} /></AppProviders>)
    renderToString(<AppProviders><QueryClientProbe clients={clients} /></AppProviders>)

    expect(clients).toHaveLength(2)
    expect(clients[0]).not.toBe(clients[1])
    expect(clients[0].getDefaultOptions()).toEqual({
      queries: { retry: false },
      mutations: { retry: false },
    })
  })
})
