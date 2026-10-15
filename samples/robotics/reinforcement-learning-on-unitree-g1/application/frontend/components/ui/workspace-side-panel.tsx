import type { ComponentProps, ReactNode } from "react"

import { cn } from "cn"

type DivProps = ComponentProps<"div">
type ParagraphProps = ComponentProps<"p">

function WorkspaceSidePanel({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="workspace-side-panel"
      className={cn("workspace-side-panel", className)}
      {...props}
    />
  )
}

function WorkspaceSidePanelIdentity({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="workspace-side-panel-identity"
      className={cn("min-w-0 px-3 py-3", className)}
      {...props}
    />
  )
}

function WorkspaceSidePanelPrimary({ className, ...props }: ParagraphProps) {
  return (
    <p
      data-slot="workspace-side-panel-primary"
      className={cn("workspace-side-primary", className)}
      {...props}
    />
  )
}

function WorkspaceSidePanelSecondary({ className, ...props }: ParagraphProps) {
  return (
    <p
      data-slot="workspace-side-panel-secondary"
      className={cn("workspace-side-secondary mt-1 text-[#7c887d]", className)}
      {...props}
    />
  )
}

function WorkspaceSidePanelSection({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="workspace-side-panel-section"
      className={cn("min-w-0", className)}
      {...props}
    />
  )
}

function WorkspaceSidePanelRow({
  label,
  className,
  children,
}: {
  label: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div
      data-slot="workspace-side-panel-row"
      className={cn(
        "flex items-center justify-between gap-3 px-3 py-2.5",
        className
      )}
    >
      <span className="shrink-0 text-xs text-[#748074]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function WorkspaceSidePanelActions({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="workspace-side-panel-actions"
      className={cn("grid gap-2 p-3 [&>*]:w-full", className)}
      {...props}
    />
  )
}

export {
  WorkspaceSidePanel,
  WorkspaceSidePanelActions,
  WorkspaceSidePanelIdentity,
  WorkspaceSidePanelPrimary,
  WorkspaceSidePanelRow,
  WorkspaceSidePanelSection,
  WorkspaceSidePanelSecondary,
}
