import { CreateWorkload, Model } from '@/types/workload'

export const SYNTHETIC_IMAGE_GENERATION_TYPE =
  'synthetic-image-generation' as const

export const SYNTHETIC_IMAGE_GENERATION_MODELS: Model[] = [
  {
    name: 'flux2-klein',
    device: 'GPU',
  },
]

export const SYNTHETIC_IMAGE_GENERATION_WORKLOAD: CreateWorkload = {
  name: 'synthetic-image-generation' as const,
  type: 'synthetic-image-generation' as const,
  models: { default: SYNTHETIC_IMAGE_GENERATION_MODELS[0] },
  port: 5015,
  healthCheck: { url: '/healthcheck' },
  engine: 'custom',
}
