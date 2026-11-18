// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { Button, cn, copyText, Dialog } from '@mujoco-studio/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ImagePlus, Settings2, X } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ToggleSwitch } from './ToggleSwitch';

import {
  commandSchema,
  DEFAULT_EXPOSED_TOOLS,
  exposedToolsSchema,
  MCP_TOOL_NAMES,
  MCP_TOOL_SUMMARIES,
  REQUIRED_MCP_TOOLS,
  type CommandResult,
  type EditorCommand,
  type McpToolName,
  type PendingCommand,
} from '@/lib/mcp/contracts';
import type { ImageJobSummary, SharedImageSummary } from '@/lib/mcp/imageJobs';
import { URL_CHARS } from '@/lib/http/urlChars';

const EXPOSED_TOOLS_KEY = 'mcp-exposed-tools';

function readExposedTools(): McpToolName[] {
  if (typeof window === 'undefined') return [...DEFAULT_EXPOSED_TOOLS];
  try {
    const stored = exposedToolsSchema.safeParse(
      JSON.parse(window.localStorage.getItem(EXPOSED_TOOLS_KEY) ?? 'null'),
    );
    return stored.success ? stored.data : [...DEFAULT_EXPOSED_TOOLS];
  } catch {
    return [...DEFAULT_EXPOSED_TOOLS];
  }
}

interface Connection {
  editorToken: string;
  agentToken: string;
}

export function McpPanel({
  onCommand,
  unavailableReason,
}: {
  onCommand: (command: EditorCommand, assertConnected: () => void) => Promise<unknown>;
  unavailableReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [transition, setTransition] = useState('Connecting');
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [exposedTools, setExposedTools] = useState(readExposedTools);
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState(false);
  const [copied, setCopied] = useState<'token' | 'config' | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [images, setImages] = useState<SharedImageSummary[]>([]);
  const [jobs, setJobs] = useState<ImageJobSummary[]>([]);
  const queryClient = useQueryClient();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const finishedJobsRef = useRef(new Set<string>());
  const connectionRef = useRef<Connection | null>(null);
  const revokeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function toggleTool(name: McpToolName) {
    const next = exposedTools.includes(name)
      ? exposedTools.filter((tool) => tool !== name)
      : MCP_TOOL_NAMES.filter((tool) => tool === name || exposedTools.includes(tool));
    setExposedTools(next);
    try {
      window.localStorage[EXPOSED_TOOLS_KEY] = JSON.stringify(next);
    } catch {
      // Storage is a convenience; the selection still applies to this connection.
    }
    const current = connectionRef.current;
    if (!current) return;
    try {
      const response = await fetch('/api/mcp/editor', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${current.editorToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tools: next }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update the agent tools.');
    }
  }

  async function shareImage(file: File) {
    const current = connectionRef.current;
    if (!current) return;
    const body = new FormData();
    body.append('image', file);
    try {
      const response = await fetch('/api/mcp/editor/images', {
        method: 'POST',
        headers: { Authorization: `Bearer ${current.editorToken}` },
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not share the image.');
      setImages((shared) => [...shared, result]);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not share the image.');
    }
  }

  async function removeImage(id: string) {
    const current = connectionRef.current;
    if (!current) return;
    const url = new URL('/api/mcp/editor/images', window.location.origin);
    url.searchParams.set('id', id);
    let target = '';
    for (const character of `${url.pathname}${url.search}`) {
      let allowedCharacter = '';
      for (const allowed of URL_CHARS) {
        if (allowed === character) {
          allowedCharacter = allowed;
          break;
        }
      }
      if (!allowedCharacter) {
        setError('Could not remove the image.');
        return;
      }
      target += allowedCharacter;
    }
    const response = await fetch(target, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${current.editorToken}` },
    });
    if (response.ok) setImages((shared) => shared.filter((image) => image.id !== id));
    else setError('Could not remove the image.');
  }

  async function enable() {
    setTransition('Connecting');
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/mcp/editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools: exposedTools }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not enable MCP.');
      connectionRef.current = body;
      setConnection(body);
      setBaseUrl(window.location.origin);
      setCommandError(false);
      setActivity(null);
      setOpen(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not enable MCP.');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    const current = connectionRef.current;
    connectionRef.current = null;
    setConnection(null);
    setImages([]);
    setJobs([]);
    if (!current) return;
    setTransition('Stopping');
    setBusy(true);
    setError(null);
    setCommandError(false);
    try {
      const response = await fetch('/api/mcp/editor', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${current.editorToken}` },
      });
      if (!response.ok)
        throw new Error(
          'Could not revoke MCP on the server; the connection will expire within 20 seconds.',
        );
      setActivity(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not disable MCP.');
    } finally {
      setBusy(false);
    }
  }

  const execute = useEffectEvent(
    async (pending: PendingCommand, assertConnected: () => void): Promise<CommandResult> => {
      try {
        assertConnected();
        const command = commandSchema.parse(pending.command);
        setCommandBusy(true);
        setCommandError(false);
        setActivity(`Running ${command.tool}...`);
        const data = await onCommand(command, assertConnected);
        setActivity(`Completed ${command.tool}.`);
        return { data };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Editor command failed.';
        setCommandError(true);
        setActivity(`Command rejected: ${message}`);
        return { error: message };
      } finally {
        setCommandBusy(false);
      }
    },
  );

  useEffect(() => {
    if (!connection) return;
    if (revokeTimerRef.current) clearTimeout(revokeTimerRef.current);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const headers = {
      Authorization: `Bearer ${connection.editorToken}`,
      'Content-Type': 'application/json',
    };
    async function poll(completion?: { id: string; result: CommandResult }) {
      try {
        const pollStartedAt = performance.now();
        const response = await fetch('/api/mcp/editor', {
          method: 'POST',
          headers,
          body: JSON.stringify({ completion }),
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'MCP editor connection failed.');
        if (stopped) return;
        setImages(body.images ?? []);
        const polledJobs: ImageJobSummary[] = body.jobs ?? [];
        setJobs(polledJobs);
        // Show agent-generated objects in the Asset Browser without a manual refresh.
        const saved = polledJobs.filter(
          (job) => job.status === 'succeeded' && !finishedJobsRef.current.has(job.id),
        );
        for (const job of saved) finishedJobsRef.current.add(job.id);
        if (saved.length) queryClient.invalidateQueries({ queryKey: ['assets'] });
        const pending: PendingCommand | null = body.command;
        if (pending) {
          const deadline = pollStartedAt + pending.remainingMs;
          const result = await execute(pending, () => {
            if (stopped) throw new Error('MCP editor connection was stopped.');
            if (connectionRef.current !== connection)
              throw new Error('MCP editor connection changed.');
            if (performance.now() >= deadline) throw new Error('MCP command expired.');
          });
          if (!stopped) await poll({ id: pending.id, result });
        } else {
          timer = setTimeout(() => void poll(), 1000);
        }
      } catch (error) {
        if (stopped) return;
        setError(error instanceof Error ? error.message : 'MCP editor connection failed.');
        connectionRef.current = null;
        setConnection(null);
      }
    }
    poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      if (connectionRef.current === connection) {
        revokeTimerRef.current = setTimeout(() => {
          revokeTimerRef.current = null;
          fetch('/api/mcp/editor', { method: 'DELETE', headers, keepalive: true }).catch(
            (error: unknown) => {
              console.error('Could not revoke MCP editor connection during cleanup.', error);
            },
          );
        }, 0);
      }
    };
  }, [connection, queryClient]);

  const config = JSON.stringify(
    {
      servers: {
        'scene-builder': {
          type: 'http',
          url: `${baseUrl}/api/mcp`,
          headers: { Authorization: 'Bearer ${input:sceneBuilderToken}' },
        },
      },
      inputs: [
        {
          id: 'sceneBuilderToken',
          type: 'promptString',
          description: 'Paste the token from Scene Builder MCP',
          password: true,
        },
      ],
    },
    null,
    2,
  );

  const status = busy
    ? transition
    : commandBusy
      ? 'Busy'
      : error || commandError
        ? 'Error'
        : connection
          ? 'Ready'
          : 'Off';
  const statusColor =
    busy || commandBusy
      ? 'bg-yellow-400'
      : error || commandError
        ? 'bg-red-400'
        : connection
          ? 'bg-green-400'
          : 'bg-white';

  async function copy(value: string, kind: 'token' | 'config') {
    try {
      await copyText(value);
      setCopied(kind);
      setCopyError(null);
    } catch {
      setCopyError('Copy failed. Select and copy the field manually.');
    }
  }

  const toggle = () => {
    setCopied(null);
    setCopyError(null);
    if (connection) disable();
    else enable();
  };

  return (
    <>
      <div
        role="group"
        aria-label="MCP server"
        className="flex shrink-0 items-center gap-2 border-l border-border pl-3"
      >
        <button
          type="button"
          aria-label="MCP settings"
          aria-haspopup="dialog"
          aria-expanded={open}
          title={`MCP: ${status}`}
          onClick={() => setOpen(true)}
          className="flex h-7 items-center gap-1.5 rounded px-1 text-[11px] text-muted outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <span
            role="status"
            aria-label={`MCP status: ${status}`}
            className={cn(
              'size-1.5 rounded-full',
              statusColor,
              (busy || commandBusy) && 'animate-pulse',
            )}
          />
          <span className="font-medium tracking-wide">MCP</span>
          <Settings2 className="size-3" />
        </button>
        <ToggleSwitch
          checked={Boolean(connection)}
          disabled={busy || (!connection && Boolean(unavailableReason))}
          label="MCP server"
          title={unavailableReason ?? `MCP: ${status}`}
          onToggle={toggle}
        />
      </div>
      <Dialog
        open={open}
        className="max-h-[90vh] max-w-xl overflow-y-auto"
        title="MCP"
        description="Let a trusted AI agent build this scene."
        onClose={() => setOpen(false)}
      >
        <div className="space-y-4 text-xs">
          <div className="flex items-center justify-between rounded border border-border bg-surface-raised px-3 py-2.5">
            <span className="flex items-center gap-2">
              <span className={cn('size-2 rounded-full', statusColor)} />
              {status}
            </span>
            <ToggleSwitch
              checked={Boolean(connection)}
              disabled={busy || (!connection && Boolean(unavailableReason))}
              label="Enable MCP"
              onToggle={toggle}
            />
          </div>
          {connection && (
            <>
              <label className="block">
                <span className="mb-1.5 flex items-center justify-between text-muted">
                  Token
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[11px]"
                    onClick={() => void copy(connection.agentToken, 'token')}
                  >
                    {copied === 'token' ? <Check /> : <Copy />}
                    {copied === 'token' ? 'Copied' : 'Copy'}
                  </Button>
                </span>
                <input
                  aria-label="MCP connection token"
                  type="password"
                  readOnly
                  value={connection.agentToken}
                  className="mt-1 w-full border border-border bg-surface-raised p-2 font-mono"
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <div className="flex items-center justify-between text-muted">
                <span>VS Code · .vscode/mcp.json</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[11px]"
                  onClick={() => void copy(config, 'config')}
                >
                  {copied === 'config' ? <Check /> : <Copy />}
                  {copied === 'config' ? 'Copied' : 'Copy config'}
                </Button>
              </div>
              <details className="rounded border border-border bg-surface-raised">
                <summary className="cursor-pointer px-3 py-2 text-muted">Configuration</summary>
                <textarea
                  aria-label="MCP client configuration"
                  readOnly
                  value={config}
                  rows={9}
                  className="w-full border border-border bg-surface-raised p-2 font-mono"
                  onFocus={(event) => event.target.select()}
                />
              </details>
              <section aria-label="Images for agent" className="space-y-2">
                <div className="flex items-center justify-between text-muted">
                  <span>Images for image-to-3D</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[11px]"
                    disabled={images.length >= 8}
                    onClick={() => imageInputRef.current?.click()}
                  >
                    <ImagePlus />
                    Share image
                  </Button>
                </div>
                <input
                  ref={imageInputRef}
                  type="file"
                  aria-label="Image to share with the agent"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) shareImage(file);
                  }}
                />
                {images.length > 0 && (
                  <ul className="divide-y divide-border rounded border border-border">
                    {images.map((image) => (
                      <li
                        key={image.id}
                        className="flex items-center justify-between gap-2 px-3 py-1.5"
                      >
                        <span className="min-w-0 truncate">
                          {image.name}
                          <span className="text-muted">
                            {' '}
                            · {(image.sizeBytes / 1024 / 1024).toFixed(1)} MB
                            {image.source === 'agent' && ' · from agent'}
                          </span>
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1"
                          aria-label={`Remove ${image.name}`}
                          onClick={() => void removeImage(image.id)}
                        >
                          <X />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {jobs.slice(-3).map((job) => (
                  <p
                    key={job.id}
                    role="status"
                    aria-label={`Image-to-3D job for ${job.imageName}`}
                    className={cn(
                      'break-words text-[11px]',
                      job.status === 'failed' ? 'text-danger' : 'text-muted',
                    )}
                  >
                    {job.imageName}:{' '}
                    {job.status === 'running'
                      ? job.stage
                      : job.status === 'succeeded'
                        ? 'Saved to Assets.'
                        : job.error}
                  </p>
                ))}
              </section>
            </>
          )}
          <fieldset className="rounded border border-border">
            <legend className="px-1 text-muted">
              Agent tools · {exposedTools.length} of {MCP_TOOL_NAMES.length} exposed
            </legend>
            <ul className="divide-y divide-border">
              {MCP_TOOL_NAMES.map((name) => {
                const required = REQUIRED_MCP_TOOLS.includes(name);
                return (
                  <li key={name} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-mono">{name}</span>
                      <span className="block text-[11px] text-muted">
                        {MCP_TOOL_SUMMARIES[name]}
                      </span>
                    </span>
                    <ToggleSwitch
                      checked={required || exposedTools.includes(name)}
                      disabled={required}
                      label={`Expose ${name}`}
                      title={
                        required ? 'Required: every edit needs its scene revision.' : undefined
                      }
                      onToggle={() => void toggleTool(name)}
                    />
                  </li>
                );
              })}
            </ul>
          </fieldset>
          {activity && (
            <p
              role="status"
              className={cn('break-words text-[11px]', commandError ? 'text-danger' : 'text-muted')}
            >
              {activity}
            </p>
          )}
          {unavailableReason && <p>{unavailableReason}</p>}
          {(error || copyError) && (
            <p role="alert" className="text-danger">
              {error || copyError}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}
