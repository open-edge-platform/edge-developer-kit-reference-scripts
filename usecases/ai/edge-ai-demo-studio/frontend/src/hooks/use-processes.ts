import { useQuery } from '@tanstack/react-query'

interface ProcessInfo {
  name: string
  status: 'active' | 'error' | 'stopped'
  pid: number
  startTime: Date
}

export const useGetProcesses = () => {
  return useQuery({
    queryKey: ['processes'],
    queryFn: async (): Promise<{ processes: ProcessInfo[] }> => {
      const response = await fetch('/api/processes')
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      return response.json() as Promise<{ processes: ProcessInfo[] }>
    },
    refetchInterval: 5000, // Refetch every 5 seconds
  })
}
