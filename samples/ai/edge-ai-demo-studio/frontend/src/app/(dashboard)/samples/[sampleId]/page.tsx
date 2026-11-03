// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { SampleDetailContent } from '@/components/samples/sample-detail-content'
import type { SampleDocs } from '@/components/samples/sample-reading-tabs'
import { getSampleById, samples } from '@/samples/registry'
import type { Sample } from '@/samples/types'

interface SamplePageProps {
  params: Promise<{ sampleId: string }>
}

async function loadSampleDocs(sample: Sample): Promise<SampleDocs | undefined> {
  if (sample.docs?.markdown) {
    return { status: 'ok', markdown: sample.docs.markdown }
  }
  if (!sample.docs?.filePath) return undefined
  const docsPath = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    sample.docs.filePath,
  )
  try {
    return { status: 'ok', markdown: await readFile(docsPath, 'utf-8') }
  } catch {
    return { status: 'unavailable' }
  }
}

export function generateStaticParams() {
  return samples.map((s) => ({ sampleId: s.id }))
}

export async function generateMetadata({
  params,
}: SamplePageProps): Promise<Metadata> {
  const sample = getSampleById((await params).sampleId)
  return sample ? { title: sample.title, description: sample.description } : {}
}

export default async function SampleDetailPage({ params }: SamplePageProps) {
  const { sampleId } = await params
  const sample = getSampleById(sampleId)

  if (!sample) {
    notFound()
  }

  // A declared guide that can't be read is `unavailable`, not "no guide", so the
  // Documentation tab can say so and offer a reload.
  const docs = await loadSampleDocs(sample)

  // Rendered even on a machine that can't run the sample; the content gates the run actions.
  return <SampleDetailContent sample={sample} docs={docs} />
}
