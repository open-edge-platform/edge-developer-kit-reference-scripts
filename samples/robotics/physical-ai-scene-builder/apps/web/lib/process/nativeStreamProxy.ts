// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

const encoder = new TextEncoder();

function framedMessage(kind: 0 | 1 | 2, payload = new Uint8Array()): Uint8Array {
  const frame = new Uint8Array(5 + payload.byteLength);
  frame[0] = kind;
  new DataView(frame.buffer).setUint32(1, payload.byteLength, true);
  frame.set(payload, 5);
  return frame;
}

function binaryMessage(value: unknown, label: string): Uint8Array<ArrayBuffer> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return copy;
  }
  throw new Error(`The native ${label} stream returned unsupported binary data.`);
}

function attachmentCount(value: string, label: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`The native ${label} stream header was not valid JSON.`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Array.isArray((parsed as { attachments?: unknown }).attachments)
  ) {
    throw new Error(`The native ${label} stream header is invalid.`);
  }
  return (parsed as { attachments: unknown[] }).attachments.length;
}

function combineMessages(messages: readonly Uint8Array[]): Uint8Array {
  const size = messages.reduce((total, message) => total + message.byteLength, 0);
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const message of messages) {
    combined.set(message, offset);
    offset += message.byteLength;
  }
  return combined;
}

/** Proxies complete native snapshots while retaining only the newest frame under backpressure. */
export function proxyNativeStream(request: Request, endpoint: string, label: string): Response {
  let socket: WebSocket | null = null;
  let flushPendingFrame = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false;
      let pendingFrame: Uint8Array | null = null;
      let assemblingFrame: { messages: Uint8Array[]; attachmentCount: number } | null = null;
      let discardedAttachments = 0;
      flushPendingFrame = () => {
        if (finished || pendingFrame === null || controller.desiredSize === null) return;
        if (controller.desiredSize <= 0) return;
        const frame = pendingFrame;
        pendingFrame = null;
        controller.enqueue(frame);
      };
      const enqueueFrame = (frame: Uint8Array) => {
        pendingFrame = frame;
        flushPendingFrame();
      };
      const completeFrame = () => {
        if (!assemblingFrame) return;
        enqueueFrame(combineMessages(assemblingFrame.messages));
        assemblingFrame = null;
      };
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        pendingFrame = null;
        assemblingFrame = null;
        if (error) controller.error(error);
        else controller.close();
      };
      socket = new WebSocket(endpoint);
      socket.binaryType = 'arraybuffer';
      socket.addEventListener('open', () => controller.enqueue(framedMessage(0)));
      socket.addEventListener('message', (event) => {
        try {
          if (typeof event.data === 'string') {
            const count = attachmentCount(event.data, label);
            assemblingFrame = null;
            discardedAttachments = 0;
            if (
              pendingFrame !== null ||
              controller.desiredSize === null ||
              controller.desiredSize <= 0
            ) {
              discardedAttachments = count;
              return;
            }
            assemblingFrame = {
              messages: [framedMessage(1, encoder.encode(event.data))],
              attachmentCount: count,
            };
            if (count === 0) completeFrame();
            return;
          }
          if (discardedAttachments > 0) {
            discardedAttachments -= 1;
            return;
          }
          if (!assemblingFrame) {
            throw new Error(`The native ${label} stream sent binary data without a header.`);
          }
          assemblingFrame.messages.push(framedMessage(2, binaryMessage(event.data, label)));
          if (assemblingFrame.messages.length - 1 === assemblingFrame.attachmentCount) {
            completeFrame();
          }
        } catch (error) {
          socket?.close();
          finish(error instanceof Error ? error : new Error('The stream proxy failed.'));
        }
      });
      socket.addEventListener('error', () =>
        finish(new Error(`The native ${label} stream could not connect.`)),
      );
      socket.addEventListener('close', () => finish());
      request.signal.addEventListener(
        'abort',
        () => {
          socket?.close();
          finish();
        },
        { once: true },
      );
    },
    pull() {
      flushPendingFrame();
    },
    cancel() {
      socket?.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate',
      'Content-Type': 'application/octet-stream',
    },
  });
}
