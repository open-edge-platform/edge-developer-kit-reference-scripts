// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import Link from 'next/link'

/** The way into the staff hub (/staff) from the CMS admin — the same
 *  arrangement as EnrollLink, for the same reason. */
export const StaffLink = () => (
  <Link className="nav__link kiosk-nav-link" href="/staff">
    <span className="nav__link-label">Staff pages</span>
  </Link>
)
