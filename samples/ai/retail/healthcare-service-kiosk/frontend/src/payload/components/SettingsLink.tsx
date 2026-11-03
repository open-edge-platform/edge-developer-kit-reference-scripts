// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import Link from 'next/link'

/** The way into the kiosk's settings page from the CMS admin — the same
 *  arrangement as EnrollLink, for the same reason. */
export const SettingsLink = () => (
  <Link className="nav__link kiosk-nav-link" href="/settings">
    <span className="nav__link-label">Kiosk settings</span>
  </Link>
)
