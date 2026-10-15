"use client"

import { useState } from "react"
import {
  ChevronRight,
  File,
  FileVideo2,
  Folder,
  FolderOpen,
  LoaderCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"

export type FileTreeEntry = {
  path: string
  is_video?: boolean
}

type FileTreeNode = {
  name: string
  file: FileTreeEntry | null
  children: FileTreeNode[]
}

type FileTreeBrowserProps = {
  id: string
  ariaLabel: string
  files: readonly FileTreeEntry[]
  isLoading: boolean
  isError: boolean
  refetch: () => unknown
  onSelectFile?: (file: FileTreeEntry) => void
}

function buildFileTree(files: readonly FileTreeEntry[]): FileTreeNode[] {
  const root: FileTreeNode = { name: "", file: null, children: [] }

  for (const file of files) {
    let parent = root
    const segments = file.path.split("/")

    for (const [index, name] of segments.entries()) {
      let node = parent.children.find((child) => child.name === name)
      if (!node) {
        node = { name, file: null, children: [] }
        parent.children.push(node)
      }
      if (index === segments.length - 1) node.file = file
      parent = node
    }
  }

  function sortNodes(nodes: FileTreeNode[]) {
    nodes.sort((left, right) => {
      if (Boolean(left.file) !== Boolean(right.file)) return left.file ? 1 : -1
      return left.name.localeCompare(right.name)
    })
    nodes.forEach((node) => sortNodes(node.children))
  }

  sortNodes(root.children)
  return root.children
}

function FileTreeRows({
  nodes,
  parentPath,
  depth,
  collapsedFolders,
  onToggleFolder,
  onSelectFile,
}: {
  nodes: FileTreeNode[]
  parentPath: string
  depth: number
  collapsedFolders: Set<string>
  onToggleFolder: (path: string) => void
  onSelectFile?: (file: FileTreeEntry) => void
}) {
  return nodes.map((node) => {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name
    const hasChildren = node.children.length > 0
    const expanded = hasChildren && !collapsedFolders.has(path)

    return (
      <li key={path} className="min-w-0">
        {hasChildren ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${path}`}
            aria-expanded={expanded}
            onClick={() => onToggleFolder(path)}
            className="flex h-8 w-full min-w-0 justify-start gap-1.5 rounded-sm px-2 text-left text-xs font-normal whitespace-normal text-[#344a36] hover:bg-[#f1f7e9] active:translate-y-0"
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            <ChevronRight
              aria-hidden="true"
              className={`size-3.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
            />
            {expanded ? (
              <FolderOpen
                aria-hidden="true"
                className="size-3.5 shrink-0 text-[#78904f]"
              />
            ) : (
              <Folder
                aria-hidden="true"
                className="size-3.5 shrink-0 text-[#78904f]"
              />
            )}
            <span className="truncate">{node.name}</span>
          </Button>
        ) : node.file && onSelectFile ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={node.file.path}
            disabled={!node.file.is_video}
            onClick={() => onSelectFile(node.file!)}
            className="flex h-8 w-full min-w-0 justify-start gap-1.5 rounded-sm px-2 text-left text-xs font-normal whitespace-normal text-[#344a36] hover:bg-[#f1f7e9] active:translate-y-0 disabled:cursor-not-allowed disabled:text-[#879087] disabled:hover:bg-transparent"
            style={{ paddingLeft: `${depth * 14 + 28}px` }}
          >
            {node.file.is_video ? (
              <FileVideo2
                aria-hidden="true"
                className="size-3.5 shrink-0 text-[#78904f]"
              />
            ) : (
              <File
                aria-hidden="true"
                className="size-3.5 shrink-0 text-[#98a198]"
              />
            )}
            <span className="truncate">{node.name}</span>
          </Button>
        ) : (
          <div
            className="flex h-8 w-full min-w-0 items-center gap-1.5 pr-2 text-xs text-[#344a36]"
            style={{ paddingLeft: `${depth * 14 + 28}px` }}
          >
            <File
              aria-hidden="true"
              className="size-3.5 shrink-0 text-[#98a198]"
            />
            <span className="truncate">{node.name}</span>
          </div>
        )}
        {expanded && (
          <ul className="space-y-0.5">
            <FileTreeRows
              nodes={node.children}
              parentPath={path}
              depth={depth + 1}
              collapsedFolders={collapsedFolders}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
            />
          </ul>
        )}
      </li>
    )
  })
}

function FileTreeBrowser({
  id,
  ariaLabel,
  files,
  isLoading,
  isError,
  refetch,
  onSelectFile,
}: FileTreeBrowserProps) {
  const [filesOpen, setFilesOpen] = useState(false)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set()
  )
  const tree = buildFileTree(files)

  function toggleFolder(path: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div data-slot="file-tree-browser">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={filesOpen}
        aria-controls={`file-tree-${id}`}
        aria-label={`${filesOpen ? "Collapse" : "Expand"} Files`}
        onClick={() => {
          const nextOpen = !filesOpen
          setFilesOpen(nextOpen)
          if (nextOpen) void refetch()
        }}
        className="flex h-10 w-full justify-between rounded-none px-3 text-left text-xs font-normal text-[#344a36] hover:bg-[#f5f7f2] active:translate-y-0"
      >
        <span className="text-[#748074]">Files</span>
        <ChevronRight
          aria-hidden="true"
          className={`size-3.5 shrink-0 transition-transform ${filesOpen ? "rotate-90" : ""}`}
        />
      </Button>
      {filesOpen && (
        <div
          id={`file-tree-${id}`}
          className="max-h-[min(21rem,65svh)] overflow-auto border-t border-[#e4e9e2] p-1.5"
        >
          {isLoading ? (
            <div
              role="status"
              className="flex h-8 items-center gap-2 px-2 text-xs text-[#7c887d]"
            >
              <LoaderCircle className="size-3.5 animate-spin" /> Loading files
            </div>
          ) : isError ? (
            <div role="alert" className="h-8 px-2 py-2 text-xs text-[#9b4934]">
              Could not load files
            </div>
          ) : tree.length ? (
            <ul aria-label={ariaLabel} className="space-y-0.5">
              <FileTreeRows
                nodes={tree}
                parentPath=""
                depth={0}
                collapsedFolders={collapsedFolders}
                onToggleFolder={toggleFolder}
                onSelectFile={onSelectFile}
              />
            </ul>
          ) : (
            <div role="status" className="h-8 px-2 py-2 text-xs text-[#7c887d]">
              No files
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export { FileTreeBrowser }
