// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SampleDemoContent } from '@/components/samples/sample-demo-content'
import { getSampleById, samples } from '@/samples/registry'

interface SampleDemoPageProps {
  params: Promise<{ sampleId: string }>
}

export function generateStaticParams() {
  return samples.map((s) => ({ sampleId: s.id }))
}

export async function generateMetadata({
  params,
}: SampleDemoPageProps): Promise<Metadata> {
  const sample = getSampleById((await params).sampleId)
  return sample
    ? { title: `${sample.title} demo`, description: sample.description }
    : {}
}

export default async function SampleDemoPage({ params }: SampleDemoPageProps) {
  const { sampleId } = await params
  const sample = getSampleById(sampleId)

  if (!sample) {
    notFound()
  }

  return <SampleDemoContent sampleId={sampleId} />
}
