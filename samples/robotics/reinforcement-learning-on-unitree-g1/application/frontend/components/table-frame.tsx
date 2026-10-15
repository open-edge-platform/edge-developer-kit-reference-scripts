import type { ReactNode } from "react"

export function TableFrame({
  header,
  children,
}: {
  header: ReactNode
  children: ReactNode
}) {
  return (
    <div className="overflow-hidden border border-[#dce3dc] bg-white">
      {header}
      {children}
    </div>
  )
}