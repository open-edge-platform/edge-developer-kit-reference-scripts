"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"

export function WorkspaceHeader() {
  const pathname = usePathname()
  const view = pathname === "/runs" ? "runs" : pathname === "/jobs" ? "jobs" : "library"

  return (
    <header className="border-b border-[#dce3dc] bg-[#fbfcf8]">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-4 px-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Image
            src="/intel.png"
            alt="Intel"
            width={60}
            height={24}
            priority
            className="h-6 w-auto shrink-0"
          />
          <div className="leading-tight">
            <p className="font-semibold tracking-[0.02em]">Video2Humanoid RL</p>
          </div>
          <div className="ml-5 hidden h-8 w-px bg-[#dce3dc] sm:block" />
          <nav className="ml-1 hidden items-center gap-1 sm:flex">
            <Link
              href="/jobs"
              aria-current={view === "jobs" ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm ${view === "jobs" ? "bg-[#eaf0e5] font-medium text-[#17251a]" : "text-[#758076] hover:bg-[#f0f3ed]"}`}
            >
              Jobs
            </Link>
            <Link
              href="/"
              aria-current={view === "library" ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm ${view === "library" ? "bg-[#eaf0e5] font-medium text-[#17251a]" : "text-[#758076] hover:bg-[#f0f3ed]"}`}
            >
              Library
            </Link>
            <Link
              href="/runs"
              aria-current={view === "runs" ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm ${view === "runs" ? "bg-[#eaf0e5] font-medium text-[#17251a]" : "text-[#758076] hover:bg-[#f0f3ed]"}`}
            >
              Training Runs
            </Link>
          </nav>
        </div>
      </div>
      <nav className="flex gap-1 border-t border-[#e8ece5] px-4 py-2 sm:hidden">
        <Link
          href="/"
          aria-current={view === "library" ? "page" : undefined}
          className={`rounded px-3 py-1.5 text-sm ${view === "library" ? "bg-[#eaf0e5] font-medium text-[#17251a]" : "text-[#758076]"}`}
        >
          Library
        </Link>
        <Link
          href="/runs"
          aria-current={view === "runs" ? "page" : undefined}
          className={`rounded px-3 py-1.5 text-sm ${view === "runs" ? "bg-[#eaf0e5] font-medium text-[#17251a]" : "text-[#758076]"}`}
        >
          Training runs
        </Link>
      </nav>
    </header>
  )
}