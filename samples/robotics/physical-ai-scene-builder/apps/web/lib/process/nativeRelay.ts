// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Dealer, Subscriber } from 'zeromq';
import { requestOrigin } from '../http/requestOrigin';

const MAX_COMMAND_BYTES = 1024 * 1024;
const MAX_PACKET_BYTES = 512 * 1024 * 1024;
const MAX_CLIENTS = 64;
const IDLE_TIMEOUT_MS = 180_000;

export type NativeRelayKind = 'teleoperation' | 'evaluation';

export function nativeRelayEndpoints(kind: NativeRelayKind, sessionId: string) {
  const base = `/api/${kind}/sessions/${encodeURIComponent(sessionId)}`;
  return {
    control: `${base}/commands`,
    ...(kind === 'teleoperation' ? { publisher: `${base}/publisher` } : {}),
  };
}

export function relayPacket(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = 4 + parts.reduce((total, part) => total + 4 + part.byteLength, 0);
  if (size > MAX_PACKET_BYTES) throw new Error('Native relay packet exceeds the size limit.');
  const packet = new Uint8Array(size);
  const view = new DataView(packet.buffer);
  view.setUint32(0, parts.length, true);
  let offset = 4;
  for (const part of parts) {
    view.setUint32(offset, part.byteLength, true);
    packet.set(part, offset + 4);
    offset += 4 + part.byteLength;
  }
  return packet;
}

class RelayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readCommand(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get('origin');
  if (origin && origin !== requestOrigin(request)) {
    throw new RelayError('Native relay commands must be same-origin.', 403);
  }
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new RelayError('Native relay commands require application/json.', 415);
  }
  if (!request.body) throw new RelayError('A command body is required.', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_COMMAND_BYTES) {
        await reader.cancel();
        throw new RelayError('Command exceeds the 1 MiB limit.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let command: unknown;
  try {
    command = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RelayError('Command must be valid JSON.', 400);
  }
  if (
    !isRecord(command) ||
    command.protocolVersion !== 1 ||
    !Number.isSafeInteger(command.requestId) ||
    Number(command.requestId) < 1 ||
    typeof command.command !== 'string' ||
    !command.command
  ) {
    throw new RelayError('A protocol v1 command and positive requestId are required.', 400);
  }
  return command;
}

interface RelayClient {
  socket: Dealer;
  busy: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Keeps one native identity per HTTP client, including across evaluation lease commands. */
export class NativeCommandRelay {
  private readonly clients = new Map<string, RelayClient>();
  private readonly publishers = new Set<Subscriber>();
  private closed = false;

  constructor(
    private readonly endpoint: string,
    private readonly kind: NativeRelayKind,
  ) {}

  close(): void {
    this.closed = true;
    for (const id of this.clients.keys()) this.remove(id);
    for (const socket of this.publishers) socket.close();
    this.publishers.clear();
  }

  publisher(request: Request, endpoint: string, sessionId: string): Response {
    if (this.closed) {
      return Response.json({ error: 'The native session has stopped.' }, { status: 410 });
    }
    if (this.publishers.size >= MAX_CLIENTS) {
      return Response.json({ error: 'Too many native state subscribers.' }, { status: 503 });
    }
    return proxyNativePublisher(request, endpoint, sessionId, this.publishers);
  }

  private remove(id: string): void {
    const client = this.clients.get(id);
    if (!client) return;
    if (client.timer) clearTimeout(client.timer);
    client.socket.close();
    this.clients.delete(id);
  }

  async respond(request: Request): Promise<Response> {
    let client: RelayClient | undefined;
    let id: string | undefined;
    let abort: (() => void) | undefined;
    try {
      const command = await readCommand(request);
      const identity = this.kind === 'teleoperation' ? command.clientId : command.sessionId;
      if (
        typeof identity !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(identity) ||
        identity.startsWith('node-admin')
      ) {
        throw new RelayError('A non-administrator client identity is required.', 400);
      }
      id = identity;
      if (this.closed) throw new RelayError('The native session has stopped.', 410);
      const timeout = Number(request.headers.get('x-studio-timeout-ms') ?? 15_000);
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120_000) {
        throw new RelayError('Command timeout must be between 1 and 120000 ms.', 400);
      }
      client = this.clients.get(id);
      if (client?.busy) throw new RelayError('A command for this client is still pending.', 409);
      if (!client) {
        if (this.clients.size >= MAX_CLIENTS) {
          throw new RelayError('The native relay has too many connected clients.', 503);
        }
        const socket = new Dealer({ linger: 0 });
        socket.routingId = `http-${id}`;
        socket.connect(this.endpoint);
        client = { socket, busy: false, timer: null };
        this.clients.set(id, client);
      }
      if (client.timer) clearTimeout(client.timer);
      client.timer = null;
      client.busy = true;
      client.socket.receiveTimeout = timeout;
      client.socket.sendTimeout = timeout;
      const activeId = id;
      abort = () => this.remove(activeId);
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) throw new RelayError('Command request was aborted.', 499);
      await client.socket.send(JSON.stringify(command));
      const parts = await client.socket.receive();
      const header = parts[0];
      if (!header) throw new RelayError('The native command response was empty.', 502);
      const response: unknown = JSON.parse(header.toString('utf8'));
      if (
        !isRecord(response) ||
        response.protocolVersion !== 1 ||
        response.requestId !== command.requestId ||
        (this.kind === 'teleoperation' ? response.clientId !== id : response.sessionId !== id)
      ) {
        throw new RelayError('The native command response identity did not match.', 502);
      }
      const observation =
        isRecord(response.result) && isRecord(response.result.observation)
          ? response.result.observation
          : null;
      const descriptors = observation?.attachments ?? [];
      if (!Array.isArray(descriptors) || descriptors.length > 4096) {
        throw new RelayError('Native observation attachments are invalid.', 502);
      }
      let total = header.byteLength;
      for (const descriptor of descriptors) {
        if (
          !isRecord(descriptor) ||
          !Number.isSafeInteger(descriptor.byteLength) ||
          Number(descriptor.byteLength) < 0 ||
          (total += Number(descriptor.byteLength)) > MAX_PACKET_BYTES - 32_768
        ) {
          throw new RelayError('Native observation exceeds the relay limits.', 502);
        }
        const attachment = await client.socket.receive();
        if (attachment.length !== 1 || attachment[0].byteLength !== descriptor.byteLength) {
          throw new RelayError('Native observation attachment length did not match.', 502);
        }
        parts.push(attachment[0]);
      }
      client.busy = false;
      client.timer = setTimeout(() => this.remove(activeId), IDLE_TIMEOUT_MS);
      client.timer.unref();
      return new Response(relayPacket(parts), {
        headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      // Do not discard another in-flight command when rejecting a concurrent request.
      if (id && client?.busy && abort) this.remove(id);
      const timeout = error instanceof Error && 'code' in error && error.code === 'EAGAIN';
      const status = error instanceof RelayError ? error.status : timeout ? 504 : 502;
      return Response.json(
        {
          error: timeout
            ? 'Native command timed out; its outcome is unknown. It was not retried.'
            : error instanceof Error
              ? error.message
              : 'Native command relay failed.',
        },
        { status },
      );
    } finally {
      if (abort) request.signal.removeEventListener('abort', abort);
    }
  }
}

/** Relays original SDK PUB multipart messages, including camera attachments, on the app port. */
function proxyNativePublisher(
  request: Request,
  endpoint: string,
  sessionId: string,
  publishers: Set<Subscriber>,
): Response {
  const socket = new Subscriber({ linger: 0, receiveHighWaterMark: 2 });
  publishers.add(socket);
  socket.subscribe(`teleop.state.v1.${sessionId}`);
  socket.connect(endpoint);
  const abort = () => {
    socket.close();
    publishers.delete(socket);
  };
  request.signal.addEventListener('abort', abort, { once: true });
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (request.signal.aborted) {
          controller.close();
          return;
        }
        const parts = await socket.receive();
        controller.enqueue(relayPacket(parts));
      } catch (error) {
        if (request.signal.aborted) controller.close();
        else controller.error(error);
        abort();
        request.signal.removeEventListener('abort', abort);
      }
    },
    cancel() {
      abort();
      request.signal.removeEventListener('abort', abort);
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
