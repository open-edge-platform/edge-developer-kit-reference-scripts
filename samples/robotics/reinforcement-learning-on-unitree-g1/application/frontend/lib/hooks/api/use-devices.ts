import { $api } from "@/lib/api"

export function useDevices() {
  return $api.useQuery("get", "/devices", undefined, { refetchInterval: 5000 })
}