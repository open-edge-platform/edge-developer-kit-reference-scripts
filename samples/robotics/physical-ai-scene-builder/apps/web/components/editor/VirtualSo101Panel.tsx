// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { Button, cn, copyText, useNotice } from '@mujoco-studio/ui';
import {
  VIRTUAL_ROBOT_ADAPTERS,
  type VirtualRobotCapability,
} from '@mujoco-studio/payload/robot-capabilities';
import { Copy, Upload, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ToggleSwitch } from './ToggleSwitch';
import { requestError } from '@/lib/http/requestError';
import type { VirtualCameraStatus, VirtualCamerasStatus } from '@/lib/virtualDevices/cameras';
import type { VirtualSo101Status } from '@/lib/virtualDevices/so101';

const ENDPOINT = VIRTUAL_ROBOT_ADAPTERS.so101.endpoint;
const CAMERAS_ENDPOINT = '/api/virtual-devices/cameras';
const POLL_INTERVAL_MS = 500;

function statusLabel(device: VirtualSo101Status | null, busy: boolean): string {
  if (busy && !device) return 'Starting';
  switch (device?.status) {
    case 'starting':
      return 'Starting';
    case 'ready':
      return 'Running';
    case 'stopping':
      return 'Stopping';
    case 'failed':
      return 'Stopped with error';
    default:
      return 'Off';
  }
}

function calibrationLabel(device: VirtualSo101Status): string {
  switch (device.calibration) {
    case 'file':
      return device.calibrationFile ?? 'Uploaded file';
    case 'custom':
      return 'Written over the serial port';
    case 'none':
      return 'Not calibrated';
    default:
      return 'Default';
  }
}

function cameraLabel(camera: VirtualCameraStatus): string {
  if (camera.state === 'ready' && camera.device) return camera.device;
  if (camera.state === 'starting') return 'Starting';
  if (camera.state === 'failed') return 'Failed';
  if (camera.state === 'stopped') return 'Stopped';
  return `${camera.width}×${camera.height}`;
}

interface VirtualSo101State {
  device: VirtualSo101Status | null;
  busy: boolean;
  error: string | null;
  streaming: boolean;
  robot: string;
  robots: readonly VirtualRobotCapability[];
  setRobot: (robot: string) => void;
  toggle: () => void;
  upload: (file: File) => void;
  clear: () => void;
  cameras: VirtualCamerasStatus | null;
  cameraBusy: boolean;
  cameraError: string | null;
  toggleCamera: (camera: VirtualCameraStatus) => void;
}

const VirtualSo101Context = createContext<VirtualSo101State | null>(null);

function useVirtualSo101(): VirtualSo101State {
  const state = useContext(VirtualSo101Context);
  if (!state) throw new Error('Virtual SO-101 panels need a VirtualSo101Provider.');
  return state;
}

/**
 * Shares the virtual device status (and its polling) with the robot and camera sections. The
 * cameras only need streaming; they do not depend on the virtual robot.
 */
export function VirtualSo101Provider({
  streaming,
  robots,
  children,
}: {
  /** A Simulate worker is streaming; the virtual devices attach to it. */
  streaming: boolean;
  robots: readonly VirtualRobotCapability[];
  children: ReactNode;
}) {
  const [device, setDevice] = useState<VirtualSo101Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [robot, setRobot] = useState('');
  const selectedRobot = robots.find((candidate) => candidate.robot === robot) ?? robots[0];
  const [cameras, setCameras] = useState<VirtualCamerasStatus | null>(null);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const response = await fetch(ENDPOINT, { cache: 'no-store' }).catch(() => null);
    if (!response?.ok || !mounted.current) return;
    const body = (await response.json()) as { device: VirtualSo101Status | null };
    setDevice(body.device);
  }, []);

  const refreshCameras = useCallback(async () => {
    const response = await fetch(CAMERAS_ENDPOINT, { cache: 'no-store' }).catch(() => null);
    if (!response?.ok || !mounted.current) return;
    setCameras((await response.json()) as VirtualCamerasStatus);
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    refreshCameras();
    return () => {
      mounted.current = false;
    };
  }, [refresh, refreshCameras]);

  const active = device?.status === 'starting' || device?.status === 'ready';
  const stopping = device?.status === 'stopping';
  useEffect(() => {
    if (!active && !stopping && !streaming) return;
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, stopping, streaming, refresh]);

  useEffect(() => {
    refreshCameras();
    if (!streaming) return;
    const timer = window.setInterval(() => void refreshCameras(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [streaming, refreshCameras]);

  const send = async (
    calibration: boolean,
    init: RequestInit,
    failure: string,
  ): Promise<VirtualSo101Status | null> => {
    const response = await fetch(calibration ? `${ENDPOINT}/calibration` : ENDPOINT, init);
    if (!response.ok) throw await requestError(response, failure);
    return ((await response.json()) as { device: VirtualSo101Status | null }).device;
  };

  const run = async (action: () => Promise<VirtualSo101Status | null>) => {
    setBusy(true);
    setError(null);
    try {
      setDevice(await action());
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusy(false);
    }
  };

  const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const value: VirtualSo101State = {
    device,
    busy,
    error,
    streaming,
    robot: selectedRobot?.robot ?? '',
    robots,
    setRobot,
    toggle: () =>
      void run(() =>
        active
          ? send(false, { method: 'DELETE' }, 'The virtual SO-101 could not stop.')
          : send(
              false,
              json(selectedRobot ? { robot: selectedRobot.robot } : {}),
              'The virtual SO-101 could not start.',
            ),
      ),
    upload: (file) =>
      void run(async () =>
        send(
          true,
          json({ name: file.name, content: await file.text() }),
          'The calibration could not be loaded.',
        ),
      ),
    clear: () =>
      void run(() => send(true, { method: 'DELETE' }, 'The calibration could not be cleared.')),
    cameras,
    cameraBusy,
    cameraError,
    toggleCamera: (camera) => {
      setCameraBusy(true);
      setCameraError(null);
      void (async () => {
        try {
          const response = await fetch(
            CAMERAS_ENDPOINT,
            json({ name: camera.name, enabled: !camera.enabled }),
          );
          if (!response.ok) throw await requestError(response, 'The camera could not be changed.');
          if (mounted.current) setCameras((await response.json()) as VirtualCamerasStatus);
        } catch (toggleError) {
          if (mounted.current) {
            setCameraError(
              toggleError instanceof Error ? toggleError.message : String(toggleError),
            );
          }
        } finally {
          if (mounted.current) setCameraBusy(false);
        }
      })();
    },
  };

  return <VirtualSo101Context.Provider value={value}>{children}</VirtualSo101Context.Provider>;
}

const badgeClass = 'text-[10px] uppercase tracking-[0.12em]';

/** Accordion header summary: the port while running, otherwise the state. */
export function VirtualRobotBadge() {
  const { device, busy } = useVirtualSo101();
  if (device?.status === 'ready' && device.devicePath) {
    return <span className={cn(badgeClass, 'normal-case text-success')}>{device.devicePath}</span>;
  }
  return (
    <span className={cn(badgeClass, device?.status === 'failed' ? 'text-danger' : 'text-muted')}>
      {statusLabel(device, busy)}
    </span>
  );
}

/** Accordion header summary: how many scene cameras are exposed. */
export function VirtualCamerasBadge() {
  const { cameras, streaming } = useVirtualSo101();
  if (!streaming || !cameras?.streaming || cameras.cameras.length === 0) {
    return <span className={cn(badgeClass, 'text-muted')}>Off</span>;
  }
  const on = cameras.cameras.filter((camera) => camera.state === 'ready').length;
  return (
    <span className={cn(badgeClass, on > 0 ? 'text-success' : 'text-muted')}>
      {on}/{cameras.cameras.length} on
    </span>
  );
}

export function CopyButton({ label, value }: { label: string; value: string }) {
  const showNotice = useNotice();
  const copy = async () => {
    try {
      await copyText(value);
    } catch {
      showNotice({
        tone: 'error',
        title: 'Copy failed',
        message: 'Select and copy the value manually.',
      });
    }
  };
  return (
    <Button
      aria-label={label}
      className="h-6 px-1.5 [&_svg]:size-3"
      onClick={() => void copy()}
      size="sm"
      type="button"
      variant="ghost"
    >
      <Copy />
    </Button>
  );
}

/** Exposes the scene's SO-101 as a Feetech serial device. */
export function VirtualRobotPanel() {
  const { device, busy, error, streaming, robot, robots, setRobot, toggle, upload, clear } =
    useVirtualSo101();
  const fileInput = useRef<HTMLInputElement>(null);

  const active = device?.status === 'starting' || device?.status === 'ready';
  const ready = device?.status === 'ready';
  const switching = busy || device?.status === 'starting' || device?.status === 'stopping';
  const message = error ?? (device?.status === 'failed' ? device.error : null);

  return (
    <div role="region" aria-label="Virtual SO-101 follower" className="space-y-3 px-3 pb-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-foreground">
            {VIRTUAL_ROBOT_ADAPTERS.so101.label}
          </p>
          <span
            role="status"
            aria-label="Virtual SO-101 status"
            className={cn(
              badgeClass,
              ready ? 'text-success' : device?.status === 'failed' ? 'text-danger' : 'text-muted',
            )}
          >
            {statusLabel(device, busy)}
          </span>
        </div>
        <ToggleSwitch
          checked={active}
          disabled={switching || (!active && !streaming)}
          label="Virtual SO-101 follower"
          onToggle={toggle}
        />
      </div>
      {!streaming && !active && (
        <p className="text-[10px] text-muted">Turn on Stream to client first.</p>
      )}
      {robots.length > 1 && (
        <select
          aria-label="Robot to expose"
          className="h-8 w-full border border-border bg-background px-2 text-[11px] text-foreground"
          onChange={(event) => setRobot(event.target.value)}
          disabled={active || switching}
          value={robot}
        >
          {robots.map((candidate) => (
            <option key={candidate.robot} value={candidate.robot}>
              {candidate.robot || 'SO-101 (template)'}
            </option>
          ))}
        </select>
      )}
      {message && <p className="text-[11px] leading-relaxed text-danger">{message}</p>}
      {ready && device.devicePath && (
        <dl className="space-y-2 text-[10px]">
          <div className="flex items-center gap-2">
            <dt className="w-16 text-muted">Port</dt>
            <dd className="flex min-w-0 flex-1 items-center gap-1">
              <code aria-label="Virtual SO-101 port" className="text-[11px] text-foreground">
                {device.devicePath}
              </code>
              <CopyButton label="Copy port" value={device.devicePath} />
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="w-16 text-muted">Calibration</dt>
            <dd className="flex min-w-0 flex-1 items-center gap-1">
              <span
                aria-label="Virtual SO-101 calibration"
                className="min-w-0 flex-1 truncate text-[11px] text-foreground"
                title={calibrationLabel(device)}
              >
                {calibrationLabel(device)}
              </span>
              <Button
                aria-label="Upload calibration"
                className="h-6 px-1.5 [&_svg]:size-3"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
                size="sm"
                title="Upload a calibration JSON file"
                type="button"
                variant="ghost"
              >
                <Upload />
              </Button>
              <Button
                aria-label="Clear calibration"
                className="h-6 px-1.5 [&_svg]:size-3"
                disabled={busy || device.calibration === 'default'}
                onClick={clear}
                size="sm"
                title="Use the default calibration"
                type="button"
                variant="ghost"
              >
                <X />
              </Button>
            </dd>
          </div>
          <input
            accept=".json,application/json"
            aria-label="Calibration file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) upload(file);
            }}
            ref={fileInput}
            type="file"
          />
        </dl>
      )}
    </div>
  );
}

/** Exposes each scene camera as a webcam while streaming, whoever drives the simulation. */
export function VirtualCamerasPanel() {
  const { cameras, cameraBusy, cameraError, streaming, toggleCamera } = useVirtualSo101();
  const message = cameraError ?? cameras?.error ?? null;

  return (
    <div role="group" aria-label="Virtual cameras" className="space-y-2 px-3 pb-3">
      {message && <p className="text-[11px] leading-relaxed text-danger">{message}</p>}
      {!streaming || !cameras?.streaming ? (
        <p className="text-[10px] text-muted">Turn on Stream to client first.</p>
      ) : cameras.cameras.length === 0 ? (
        <p className="text-[10px] text-muted">This scene has no cameras.</p>
      ) : (
        cameras.cameras.map((camera) => (
          <div key={camera.name} className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
                {camera.name}
              </span>
              <code
                aria-label={`Virtual camera ${camera.name} device`}
                className={cn(
                  'text-[10px]',
                  camera.state === 'ready'
                    ? 'text-foreground'
                    : camera.state === 'failed'
                      ? 'text-danger'
                      : 'text-muted',
                )}
              >
                {cameraLabel(camera)}
              </code>
              {camera.state === 'ready' && camera.device && (
                <CopyButton label={`Copy ${camera.name} device`} value={camera.device} />
              )}
              <ToggleSwitch
                checked={camera.enabled}
                disabled={cameraBusy}
                label={`Virtual camera ${camera.name}`}
                onToggle={() => toggleCamera(camera)}
              />
            </div>
            {camera.state === 'failed' && camera.error && (
              <p className="text-[10px] leading-relaxed text-danger">{camera.error}</p>
            )}
          </div>
        ))
      )}
    </div>
  );
}
