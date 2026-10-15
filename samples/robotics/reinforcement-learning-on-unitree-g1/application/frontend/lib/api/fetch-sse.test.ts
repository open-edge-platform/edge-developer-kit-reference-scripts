import { afterEach, describe, expect, it, vi } from "vitest"

import { connectJobEvents } from "./fetch-sse"

class MockEventSource {
  static instances: MockEventSource[] = []

  readonly listeners = new Map<string, Array<(event: Event) => void>>()
  closed = false

  constructor(readonly url: string) {
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = typeof listener === "function"
      ? listener
      : (event: Event) => listener.handleEvent(event)
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback])
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as unknown as Event
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }

  close() {
    this.closed = true
  }
}

afterEach(() => {
  MockEventSource.instances = []
  vi.unstubAllGlobals()
})

describe("connectJobEvents", () => {
  it("parses named log and status events and closes the stream", () => {
    vi.stubGlobal("EventSource", MockEventSource)
    const onLog = vi.fn()
    const onStatus = vi.fn()
    const close = connectJobEvents("job-1", { onLog, onStatus })
    const stream = MockEventSource.instances[0]
    const job = {
      id: "job-1",
      kind: "train",
      payload: {},
      status: "running",
      created_at: "2026-10-05T00:00:00Z",
    }

    expect(stream.url).toBe("/api/jobs/job-1/events")
    stream.emit("log", { line: "training started" })
    stream.emit("status", job)

    expect(onLog).toHaveBeenCalledWith("training started")
    expect(onStatus).toHaveBeenCalledWith(job)
    close()
    expect(stream.closed).toBe(true)
  })
})