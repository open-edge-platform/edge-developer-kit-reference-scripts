// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { randomBytes, randomUUID } from 'node:crypto';

import {
  DEFAULT_EXPOSED_TOOLS,
  REQUIRED_MCP_TOOLS,
  type CommandResult,
  type EditorCommand,
  type McpToolName,
  type PendingCommand,
} from './contracts';

const HEARTBEAT_TIMEOUT = 20_000;
const COMMAND_TIMEOUT = 30_000;
interface Job {
  pending: PendingCommand;
  expiresAt: number;
  delivered: boolean;
  complete: (result: CommandResult) => void;
}
interface Session {
  editorToken: string;
  agentToken: string;
  lastSeen: number;
  exposedTools: Set<McpToolName>;
  job?: Job;
  requests: Map<string, { fingerprint: string; result: Promise<CommandResult> }>;
}

const globalBridge = globalThis as typeof globalThis & {
  sceneMcpSessions?: Map<string, Session>;
  sceneMcpDisconnectListeners?: Set<(editorToken: string) => void>;
};
const sessions = (globalBridge.sceneMcpSessions ??= new Map<string, Session>());
const disconnectListeners = (globalBridge.sceneMcpDisconnectListeners ??= new Set());

/** Runs when an editor disconnects or expires, so per-session state elsewhere is released. */
export function onEditorDisconnect(listener: (editorToken: string) => void) {
  disconnectListeners.add(listener);
}

export function isEditorConnected(editorToken: string): boolean {
  return sessions.has(editorToken);
}

function prune() {
  for (const session of sessions.values()) {
    if (!session.job && Date.now() - session.lastSeen > HEARTBEAT_TIMEOUT)
      disconnect(session.editorToken);
  }
}

function exposedSet(tools: readonly McpToolName[]) {
  return new Set([...REQUIRED_MCP_TOOLS, ...tools]);
}

export function connectEditor(tools: readonly McpToolName[] = DEFAULT_EXPOSED_TOOLS) {
  prune();
  if (sessions.size >= 16)
    throw new Error('Too many MCP editors are connected. Disconnect an unused editor.');
  const session: Session = {
    editorToken: randomBytes(32).toString('hex'),
    agentToken: randomBytes(32).toString('hex'),
    lastSeen: Date.now(),
    exposedTools: exposedSet(tools),
    requests: new Map(),
  };
  sessions.set(session.editorToken, session);
  return { editorToken: session.editorToken, agentToken: session.agentToken };
}

export function disconnect(editorToken: string) {
  const session = sessions.get(editorToken);
  session?.job?.complete({
    error: 'Editor disconnected. Read get_scene before attempting another edit.',
  });
  if (!sessions.delete(editorToken)) return;
  for (const listener of disconnectListeners) listener(editorToken);
}

export function authenticateAgent(token: string): string | null {
  prune();
  for (const session of sessions.values()) {
    if (session.agentToken === token) return session.editorToken;
  }
  return null;
}

export function setExposedTools(editorToken: string, tools: readonly McpToolName[]) {
  const session = sessions.get(editorToken);
  if (!session) throw new Error('MCP connection expired. Disable and enable MCP again.');
  session.exposedTools = exposedSet(tools);
}

/** Tools the editor user allows agents to see and call; empty when the editor is gone. */
export function exposedTools(editorToken: string): ReadonlySet<McpToolName> {
  return sessions.get(editorToken)?.exposedTools ?? new Set();
}

export function pollEditor(
  editorToken: string,
  completion?: { id: string; result: CommandResult },
) {
  prune();
  const session = sessions.get(editorToken);
  if (!session) throw new Error('MCP connection expired. Disable and enable MCP again.');
  session.lastSeen = Date.now();
  if (completion) {
    if (session.job?.pending.id !== completion.id)
      throw new Error('This MCP command expired. Read the scene before retrying.');
    session.job.complete(completion.result);
  }
  if (!session.job || session.job.delivered) return null;
  session.job.delivered = true;
  return {
    ...session.job.pending,
    remainingMs: Math.max(0, session.job.expiresAt - Date.now()),
  };
}

export function dispatchCommand(
  editorToken: string,
  command: EditorCommand,
): Promise<CommandResult> {
  prune();
  const session = sessions.get(editorToken);
  if (!session)
    return Promise.resolve({ error: 'No connected editor. Enable MCP in the scene editor.' });
  const requestId = 'requestId' in command.input ? command.input.requestId : undefined;
  const fingerprint = JSON.stringify(command);
  if (requestId) {
    const existing = session.requests.get(requestId);
    if (existing) {
      return existing.fingerprint === fingerprint
        ? existing.result
        : Promise.resolve({ error: 'requestId was already used for a different command.' });
    }
  }
  if (session.job)
    return Promise.resolve({ error: 'Editor is busy. Wait for the current tool call to finish.' });
  const id = randomUUID();
  const result = new Promise<CommandResult>((resolve) => {
    const timer = setTimeout(() => {
      session.job?.complete({
        error:
          'Editor timed out; the outcome is unknown. Do not blindly retry. Reconnect and inspect the scene.',
      });
      disconnect(editorToken);
    }, COMMAND_TIMEOUT);
    session.job = {
      pending: { id, command, remainingMs: COMMAND_TIMEOUT },
      expiresAt: Date.now() + COMMAND_TIMEOUT,
      delivered: false,
      complete: (response) => {
        clearTimeout(timer);
        session.job = undefined;
        resolve(response);
      },
    };
  });
  if (requestId) {
    if (session.requests.size >= 100) {
      const oldest = session.requests.keys().next().value;
      if (oldest) session.requests.delete(oldest);
    }
    session.requests.set(requestId, { fingerprint, result });
  }
  return result;
}
