import type { components } from "../api-schema"
import { jobEventsUrl } from "./urls"

type Job = components["schemas"]["Job"]

export function connectJobEvents(
  jobId: string,
  callbacks: { onLog: (line: string) => void; onStatus: (job: Job) => void },
) {
  const stream = new EventSource(jobEventsUrl(jobId))

  stream.addEventListener("log", (event) => {
    try {
      const message = JSON.parse((event as MessageEvent<string>).data) as { line: string }
      callbacks.onLog(message.line)
    } catch {
      return
    }
  })

  stream.addEventListener("status", (event) => {
    try {
      callbacks.onStatus(JSON.parse((event as MessageEvent<string>).data) as Job)
    } catch {
      return
    }
  })

  return () => stream.close()
}