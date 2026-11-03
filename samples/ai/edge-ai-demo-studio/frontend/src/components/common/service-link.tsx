// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import Link from 'next/link'
import type { ComponentProps } from 'react'
import {
  serviceHref,
  type ServiceHrefOptions,
} from '@/lib/instances/service-presentation'
import { HREF_CHARS, safeHref } from '@/lib/validation'

type ServiceLinkProps = Omit<ComponentProps<typeof Link>, 'href'> &
  ServiceHrefOptions & { serviceType: string }

/**
 * A `<Link>` to a service's page ({@link serviceHref}). The address is
 * rebuilt from `HREF_CHARS` right here beside the `<Link>`: a link built
 * elsewhere and passed in as `href` does not pass the Coverity scan.
 */
export function ServiceLink({
  serviceType,
  instanceId,
  tab,
  logLevel,
  logSource,
  ...props
}: ServiceLinkProps) {
  let href = ''
  for (const ch of safeHref(
    serviceHref(serviceType, { instanceId, tab, logLevel, logSource }),
  )) {
    let ok = ''
    for (const allowed of HREF_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) {
      href = '/'
      break
    }
    href += ok
  }
  return <Link {...props} href={href} />
}
