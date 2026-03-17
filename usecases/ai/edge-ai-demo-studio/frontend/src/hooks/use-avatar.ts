import { FetchAPI } from '@/lib/api'
import { useMutation } from '@tanstack/react-query'

const AVATAR_API = new FetchAPI(`/api/digital-avatar-lite`)

export const useUpdateAvatarState = () => {
  return useMutation({
    mutationFn: async (state: { state: 'idle' | 'talking' | 'waving' }) => {
      const response = await AVATAR_API.post('stream', state)
      return response
    },
  })
}
