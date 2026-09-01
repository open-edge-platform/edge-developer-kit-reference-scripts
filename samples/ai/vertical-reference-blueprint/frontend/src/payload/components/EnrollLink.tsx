// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import Link from 'next/link'

/**
 * The way into the registration desk from the CMS admin.
 *
 * The desk is a Next.js page of its own rather than a Payload view — it needs
 * a live camera and the card reader — so the admin has no idea it exists
 * unless something says so. This is that something: one more entry under the
 * nav links, styled as Payload styles its own (see custom.scss).
 */
export const EnrollLink = () => (
  <Link className="nav__link kiosk-nav-link" href="/enroll">
    <span className="nav__link-label">Registration desk</span>
  </Link>
)
