// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { LoaderCircle, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"

type ConfirmDeleteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  itemName: string
  pending: boolean
  onConfirm: () => void
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  itemName,
  pending,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0">
        <div className="border-b border-[#dce3dc] px-5 py-4">
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          <DialogDescription className="mt-1 text-xs text-[#748074]">{description}</DialogDescription>
        </div>
        <p className="break-all px-5 py-4 text-sm font-medium">{itemName}</p>
        <div className="flex justify-end gap-2 border-t border-[#dce3dc] px-5 py-3">
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}