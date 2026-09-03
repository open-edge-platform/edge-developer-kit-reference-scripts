// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * How the kiosk decides whether an AI service is up.
 *
 * "ok" — reachable (or mocked, which needs no service); "off" — intentionally
 * not configured; "unreachable" — configured but not responding.
 *
 * The status code is what separates the last two, and it has to: when the
 * services sit behind a gateway, the gateway answers even for a worker that
 * is stopped, so a connection error never happens. The Edge AI Demo Studio
 * gateway returns 500 for an inactive service and 404 for a path its live
 * worker does not serve — which is why a 4xx counts as up (something is
 * listening) and a 5xx does not (it is listening and broken).
 *
 * Other servers answer differently, so neither the path probed nor whether a
 * service is probed at all is fixed here — see `health_path` and
 * `health_check` in config.yaml.
 */
export type ServiceHealth = "ok" | "off" | "unreachable";

const TIMEOUT_MS = 5_000;

/** A `health_check:` setting; anything but an explicit false leaves it on. */
export const healthCheckEnabled = (name: string) =>
  (process.env[name] ?? "true") !== "false";

export type HealthProbe = {
  /** Base URL of the service. Undefined means it is not configured at all. */
  baseUrl?: string;
  /** Appended to the base URL to form the probe URL, e.g. "/healthcheck". */
  path?: string;
  /**
   * False turns the probe off: the service is reported "ok" without being
   * contacted. That silences the out-of-service screen for a service whose
   * health endpoint the kiosk cannot read — it does NOT make anything trust
   * the service, because every call site still handles its own failure. A
   * document the OCR service cannot read is still unverified either way.
   */
  enabled?: boolean;
  headers?: Record<string, string>;
};

export async function probeService({
  baseUrl,
  path = "",
  enabled = true,
  headers,
}: HealthProbe): Promise<ServiceHealth> {
  if (!baseUrl) return "off";
  if (!enabled) return "ok";
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...(headers ? { headers } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.status >= 500 ? "unreachable" : "ok";
  } catch {
    return "unreachable";
  }
}
