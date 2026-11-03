// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * An error carrying the HTTP status a route should answer with (see `jsonErrorFrom`). No Next.js
 * imports, so modules loaded outside Next (the Payload CLI) can throw it.
 */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ApiError'
    this.status = status
  }
}
