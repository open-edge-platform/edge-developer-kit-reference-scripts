'use server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getModelNameWithPrefix } from '@/utils/common'
import { Workload } from '@/payload-types'

export async function getWorkloadModel(
  workloadType: Workload['type'],
): Promise<string> {
  const payload = await getPayload({ config })
  const textGenerationDoc = await payload.find({
    collection: 'workloads',
    where: { type: { equals: workloadType } },
    limit: 1,
  })

  if (textGenerationDoc.totalDocs < 1)
    return Promise.reject(`No ${workloadType} workload found`)

  const textGenerationWorkload = textGenerationDoc.docs[0]
  return getModelNameWithPrefix(
    textGenerationWorkload.engine,
    textGenerationWorkload.models.default,
  )
}
