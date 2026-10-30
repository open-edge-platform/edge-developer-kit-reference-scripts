// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useState } from "react"
import { FileVideo2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { FileTreeBrowser } from "@/components/ui/file-tree-browser"
import type { Asset, AssetFile } from "@/lib/api"
import { useAssetFiles } from "@/lib/hooks/api/use-assets"

type AssetFilesBrowserProps = {
  asset: Asset
}

export function AssetFilesBrowser({ asset }: AssetFilesBrowserProps) {
  const filesQuery = useAssetFiles(asset.id)
  const [playingFile, setPlayingFile] = useState<AssetFile | null>(null)
  const files = filesQuery.data ?? []
  const videoUrl = new URL("/api/assets/", "http://localhost")
  if (playingFile) {
    const encodedPath = playingFile.path.split("/").map(encodeURIComponent).join("/")
    videoUrl.pathname += `${encodeURIComponent(asset.id)}/files/${encodedPath}`
  }

  return (
    <>
      <FileTreeBrowser
        id={`asset-${asset.id}`}
        ariaLabel="Asset files"
        files={files}
        isLoading={filesQuery.isLoading}
        isError={filesQuery.isError}
        refetch={filesQuery.refetch}
        onSelectFile={(file) => {
          if (file.is_video) setPlayingFile({ path: file.path, is_video: true })
        }}
      />

      <Dialog
        open={playingFile !== null}
        onOpenChange={(open) => {
          if (!open) setPlayingFile(null)
        }}
      >
        <DialogContent className="w-[min(64rem,calc(100vw-2rem))] max-w-none p-0">
          <header className="flex items-start justify-between gap-4 border-b border-[#dce3dc] px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-start gap-2">
              <FileVideo2 className="mt-0.5 shrink-0 text-[#81917f]" size={16} />
              <div className="min-w-0">
                <DialogTitle className="text-sm font-semibold">Video Preview</DialogTitle>
                <DialogDescription className="mt-1 break-all font-mono text-[11px] text-[#748074]">
                  {playingFile?.path}
                </DialogDescription>
              </div>
            </div>
            <DialogClose
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Close video preview" title="Close">
                  <X />
                </Button>
              }
            />
          </header>
          {playingFile && (
            <div className="relative aspect-video max-h-[78svh] w-full bg-[#101713]">
              <video
                key={playingFile.path}
                className="absolute inset-0 size-full object-contain"
                src={videoUrl.pathname}
                controls
                autoPlay
                playsInline
                preload="metadata"
                aria-label={`${asset.filename}: ${playingFile.path}`}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}