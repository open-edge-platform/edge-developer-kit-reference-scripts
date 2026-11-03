// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import Link from 'next/link'

/** The way into the demo reset (/demo-visit) from the CMS admin — the same
 *  arrangement as EnrollLink. Only this link leads there, so it stays out of
 *  sight of anyone watching the staff pages during a demo. */
export const DemoVisitLink = () => (
  <Link className="nav__link kiosk-nav-link" href="/demo-visit">
    <span className="nav__link-label">Demo reset</span>
  </Link>
)
