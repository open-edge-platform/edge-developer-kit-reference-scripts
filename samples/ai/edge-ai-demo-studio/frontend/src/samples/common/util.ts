import { Service } from '@/services/types'
import {
  getOptionalServicesForSample,
  getRequiredServicesForSample,
} from '../registry'
import { Sample } from '../types'

export const computeSampleReadiness = (sample: Sample, services: Service[]) => {
  const requiredServices = getRequiredServicesForSample(sample)
  const allRequiredOnline = requiredServices.every(
    (s) => services.find((service) => service.id === s.id)?.status === 'online',
  )
  if (!allRequiredOnline) return 'blocked'

  const optionalServices = getOptionalServicesForSample(sample)
  if (optionalServices.length === 0) return 'ready'
  const allOptionalOnline = optionalServices.every(
    (s) => services.find((service) => service.id === s.id)?.status === 'online',
  )
  return allOptionalOnline ? 'ready' : 'partial'
}
