// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Notice } from '@mujoco-studio/ui';

import { RequestError } from './http/requestError';
import { ScenePackageError } from './scenes/scenePackage';

function sentence(text: string): string {
  const trimmed = text.trim();
  const capitalised = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

/**
 * Turns a failed user action into an error notice. HTTP 409 (conflict with the current state,
 * e.g. "stop recording first") is shown as a warning because the user only needs to wait or undo.
 */
export function noticeFromError(
  title: string,
  reason: unknown,
  fallback: string,
  hint?: string,
): Notice {
  if (reason instanceof ScenePackageError) {
    return {
      tone: 'error',
      title,
      message: sentence(reason.summary),
      details: reason.details,
      detailsLabel: reason.detailsLabel,
      hint: reason.hint ?? hint,
    };
  }
  if (reason instanceof RequestError) {
    return {
      tone: reason.status === 409 ? 'warning' : 'error',
      title,
      message: sentence(reason.message),
      details: reason.details,
      detailsLabel: reason.detailsLabel,
      hint,
    };
  }
  return {
    tone: 'error',
    title,
    message: sentence(reason instanceof Error && reason.message ? reason.message : fallback),
    hint,
  };
}
