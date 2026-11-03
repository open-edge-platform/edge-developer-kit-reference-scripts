// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { Service, ServiceDocsData } from '@/services/types'
import { buildNavItems } from '../docs-nav-items'
import { useActiveSection } from '../use-active-section'
import { BaseUrl } from './base-url'
import CodeBlock from './codeblock'
import { DocsNavigation } from './docs-navigation'
import { DocsText } from './docs-text'
import { EndpointsSection } from './endpoints-section'
import { ErrorsSection } from './errors-section'
import { QuickStartSection } from './quick-start-section'
import { SampleCodeSection } from './sample-code-section'

export function ServiceDocs({
  service,
  docs,
  baseUrl,
}: {
  service: Service
  docs: ServiceDocsData
  baseUrl?: string
}) {
  const navItems = buildNavItems(docs)
  const sampleCode = docs.sampleCode ?? []
  const { activeId, onNavigate } = useActiveSection(navItems)
  const backends = {
    backends: docs.backends ?? [],
    active: docs.activeBackend,
  }

  return (
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_184px]">
      <div className="order-first min-w-0 self-stretch xl:order-last">
        <DocsNavigation
          navItems={navItems}
          activeId={activeId}
          onNavigate={onNavigate}
        />
      </div>
      <article
        aria-label={`${service.name} documentation`}
        className="border-border bg-card min-w-0 space-y-9 rounded-2xl border p-4 sm:p-6 lg:p-7"
      >
        <BaseUrl value={baseUrl} />
        <QuickStartSection quickStart={docs.quickStart} service={service} />
        {docs.serviceDescription && (
          <section id="about" tabIndex={-1} className="docs-section space-y-3">
            <h2 className="text-lg font-semibold">Overview</h2>
            <DocsText>{docs.serviceDescription}</DocsText>
          </section>
        )}
        <section
          id="api-overview"
          tabIndex={-1}
          className="docs-section space-y-3"
        >
          <h2 className="text-lg font-semibold">API overview</h2>
          <DocsText>{docs.overview}</DocsText>
        </section>
        <EndpointsSection
          endpoints={docs.endpoints ?? []}
          backends={backends}
        />
        {docs.errors && <ErrorsSection errors={docs.errors} />}
        {docs.responseExample && (
          <section
            id="response"
            tabIndex={-1}
            className="docs-section space-y-4"
          >
            <h2 className="text-lg font-semibold">Response example</h2>
            <CodeBlock
              title="Response"
              data={[
                {
                  language: 'JSON',
                  languageCode: 'json',
                  code: docs.responseExample,
                },
              ]}
            />
          </section>
        )}
        {sampleCode.length > 0 && (
          <SampleCodeSection
            intro={docs.sampleCodeIntro}
            samples={sampleCode}
          />
        )}
      </article>
    </div>
  )
}
