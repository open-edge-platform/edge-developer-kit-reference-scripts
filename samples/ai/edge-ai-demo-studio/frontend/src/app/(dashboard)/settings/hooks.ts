// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { THEME_QUERY_KEY } from '@/context/theme-provider'
import { HF_TOKEN_QUERY_KEY } from '@/hooks/use-has-hf-token'
import { fetchJson, isHttpError, postJson } from '@/lib/browser/fetch-json'
import type { DeploymentSnapshot } from '@/lib/deployment/deployment-snapshot'
import { getErrorMessage } from '@/lib/errors'
import type { Theme } from '@/lib/settings/app-settings'
import {
  changedFields,
  type SaveResults,
  type SettingsChanges,
  type SettingsField,
} from './settings-draft'

export type { DeploymentSnapshot }

const STARTUP_TIMEOUT_QUERY_KEY = ['settings', 'startup-timeout'] as const
const PROXY_TIMEOUT_QUERY_KEY = ['settings', 'proxy-timeout'] as const
const DEPLOYMENT_QUERY_KEY = ['settings', 'deployment'] as const

/**
 * The reason a settings request failed, in words: `fetch` itself rejects
 * with a `TypeError` when the app server cannot be reached at all.
 */
export function describeRequestError(error: unknown): string {
  if (error instanceof TypeError) return 'The app server could not be reached.'
  const message = getErrorMessage(error, 'The request failed.').trim()
  // It is shown inside a sentence: "… could not be loaded: <reason> …".
  return /[.!?]$/.test(message) ? message : `${message}.`
}

/** Whether a saved value can be shown and edited yet. */
export type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; retrying: boolean }
  | { status: 'ready' }

interface LoadableQuery {
  data: unknown
  isSuccess: boolean
  isFetched: boolean
  isError: boolean
  isFetching: boolean
  error: unknown
}

/**
 * Ready only once a request answered: the theme query starts from server-rendered `initialData`,
 * which may be a fallback. Once `confirmed`, a failed refetch keeps the value editable.
 */
function loadStateOf(query: LoadableQuery, confirmed: boolean): LoadState {
  if (confirmed && query.data !== undefined) return { status: 'ready' }
  if (query.isError) {
    return {
      status: 'error',
      message: describeRequestError(query.error),
      retrying: query.isFetching,
    }
  }
  if (query.isSuccess && query.isFetched) return { status: 'ready' }
  return { status: 'loading' }
}

/** {@link loadStateOf}, confirmed from the first time it is ready on this page. */
export function useLoadState(query: LoadableQuery): LoadState {
  const [confirmed, setConfirmed] = useState(false)
  const state = loadStateOf(query, confirmed)
  if (state.status === 'ready' && !confirmed) setConfirmed(true)
  return state
}

/** The theme provider's query, refetched on mount so Appearance only shows a confirmed value. */
export function useConfirmedTheme() {
  return useQuery({
    queryKey: THEME_QUERY_KEY,
    queryFn: () => fetchJson<{ theme: Theme }>('/api/settings/theme'),
    refetchOnMount: 'always',
  })
}

export function useStartupTimeout() {
  return useQuery({
    queryKey: STARTUP_TIMEOUT_QUERY_KEY,
    queryFn: () =>
      fetchJson<{ startupTimeout: number }>('/api/settings/startup-timeout'),
  })
}

/** The saved proxy timeout; the instance proxy applies it to new requests at once. */
export function useProxyTimeout() {
  return useQuery({
    queryKey: PROXY_TIMEOUT_QUERY_KEY,
    queryFn: () =>
      fetchJson<{ proxyTimeout: number }>('/api/settings/proxy-timeout'),
  })
}

/** One field's own request: each setting is saved, and can fail, on its own. */
function saveField(field: SettingsField, changes: SettingsChanges) {
  switch (field) {
    case 'theme':
      return postJson('/api/settings/theme', { theme: changes.theme })
    case 'hfToken':
      return postJson('/api/settings/hf-token', { hfToken: changes.hfToken })
    case 'startupTimeout':
      return postJson('/api/settings/startup-timeout', {
        startupTimeout: changes.startupTimeout,
      })
    case 'proxyTimeout':
      return postJson('/api/settings/proxy-timeout', {
        proxyTimeout: changes.proxyTimeout,
      })
  }
}

/** Saves each changed setting in its own request and reports each outcome separately. */
export function useSaveSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (changes: SettingsChanges): Promise<SaveResults> => {
      const fields = changedFields(changes)
      const settled = await Promise.allSettled(
        fields.map((field) => saveField(field, changes)),
      )
      const results: SaveResults = {}
      fields.forEach((field, i) => {
        const result = settled[i]
        results[field] =
          result.status === 'fulfilled'
            ? { ok: true }
            : { ok: false, error: describeRequestError(result.reason) }
      })
      return results
    },
    onSuccess: (results, changes) => {
      // Saved values go straight into the cache, so the page never shows
      // the old value while the queries refetch to confirm.
      if (results.theme?.ok && changes.theme !== undefined) {
        queryClient.setQueryData(THEME_QUERY_KEY, { theme: changes.theme })
      }
      if (results.hfToken?.ok && changes.hfToken !== undefined) {
        queryClient.setQueryData(HF_TOKEN_QUERY_KEY, {
          hasToken: changes.hfToken.trim() !== '',
        })
      }
      if (results.startupTimeout?.ok) {
        queryClient.setQueryData(STARTUP_TIMEOUT_QUERY_KEY, {
          startupTimeout: changes.startupTimeout,
        })
      }
      if (results.proxyTimeout?.ok) {
        queryClient.setQueryData(PROXY_TIMEOUT_QUERY_KEY, {
          proxyTimeout: changes.proxyTimeout,
        })
      }
    },
    onSettled: (_results, _error, changes) => {
      const keys = {
        theme: THEME_QUERY_KEY,
        hfToken: HF_TOKEN_QUERY_KEY,
        startupTimeout: STARTUP_TIMEOUT_QUERY_KEY,
        proxyTimeout: PROXY_TIMEOUT_QUERY_KEY,
      }
      for (const field of changedFields(changes)) {
        queryClient.invalidateQueries({ queryKey: keys[field] })
      }
    },
  })
}

export function useDeploymentSnapshot(enabled: boolean) {
  return useQuery({
    queryKey: DEPLOYMENT_QUERY_KEY,
    enabled,
    staleTime: 0,
    queryFn: () =>
      fetchJson<DeploymentSnapshot>('/api/settings/deployment', {
        errorMessage: 'The current deployment could not be read.',
      }),
  })
}

/**
 * The up-to-date snapshot a `409` from saving carries: the services changed
 * after the dialog showed them, so nothing was written.
 */
export function changedSnapshot(
  error: unknown,
): DeploymentSnapshot | undefined {
  if (!isHttpError(error, 409)) return undefined
  const body = error.body as { snapshot?: DeploymentSnapshot } | undefined
  return body?.snapshot
}

/**
 * Writes exactly the deployment.json snapshot the dialog showed; the server refuses (409, with the
 * current snapshot) if the services or the file changed since.
 */
export function useSaveDeployment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (shown: DeploymentSnapshot) =>
      postJson<DeploymentSnapshot>(
        '/api/settings/deployment',
        { expected: shown.config, overwrite: shown.exists },
        { errorMessage: 'deployment.json could not be written.' },
      ),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(DEPLOYMENT_QUERY_KEY, snapshot)
    },
    onError: (error) => {
      const current = changedSnapshot(error)
      if (current) queryClient.setQueryData(DEPLOYMENT_QUERY_KEY, current)
    },
  })
}
