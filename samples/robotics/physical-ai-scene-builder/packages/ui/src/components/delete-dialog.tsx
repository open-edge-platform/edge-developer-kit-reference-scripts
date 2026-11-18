// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { LoaderCircle, Trash2 } from 'lucide-react';

import { Button } from './button';
import { Dialog } from './dialog';

export interface DeleteDialogProps {
  open: boolean;
  itemName: string;
  itemType:
    'project' | 'scene' | 'checkpoint' | 'episode' | 'export' | 'generated scene' | 'scene version';
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteDialog({
  open,
  itemName,
  itemType,
  busy = false,
  onCancel,
  onConfirm,
}: DeleteDialogProps) {
  const description =
    itemType === 'project'
      ? `This permanently deletes "${itemName}", its scenes, private uploads, recordings, and generated datasets.`
      : itemType === 'scene'
        ? `This permanently deletes "${itemName}", its unshared private uploads, recordings, and generated datasets.`
        : itemType === 'scene version'
          ? `This permanently deletes the ${itemName}: its generated scenes and recorded episodes.`
          : `This permanently deletes "${itemName}".`;

  return (
    <Dialog open={open} title={`Delete ${itemType}?`} description={description} onClose={onCancel}>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={onConfirm}
          disabled={busy}
          aria-label={`Delete ${itemType}`}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
          {busy ? 'Deleting' : `Delete ${itemType}`}
        </Button>
      </div>
    </Dialog>
  );
}
