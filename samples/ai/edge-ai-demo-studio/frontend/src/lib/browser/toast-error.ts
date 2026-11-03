// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/errors'

/** An `onError` handler that toasts `title` with the thrown message as its description. */
export function toastError(title: string) {
  return (err: unknown) => {
    toast.error(title, { description: getErrorMessage(err) })
  }
}
