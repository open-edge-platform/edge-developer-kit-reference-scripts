// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  ChevronDown,
  CircleAlert,
  Download,
  FileJson,
  Info,
  Loader,
  RotateCw,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { downloadBlob } from '@/lib/browser/download'
import {
  DeploymentSummaryList,
  summarizeDeployment,
} from './deployment-summary'
import {
  changedSnapshot,
  describeRequestError,
  type DeploymentSnapshot,
  useDeploymentSnapshot,
  useSaveDeployment,
} from './hooks'

const FILE_NAME = 'deployment.json'

/**
 * What the file does at every later start, as `applyDeploymentConfig` applies it: it is the whole
 * setup, so unlisted instances are deleted, listed ones get its settings back, only `online` start.
 */
function StartupConsequences({
  snapshot,
  autostartCount,
  instanceCount,
}: {
  snapshot: DeploymentSnapshot
  autostartCount: number
  instanceCount: number
}) {
  return (
    <section
      aria-labelledby="deployment-consequences-title"
      className="space-y-2"
      data-testid="deployment-consequences"
    >
      <h3
        id="deployment-consequences-title"
        className="text-foreground text-sm font-semibold"
      >
        What saving does
      </h3>
      {snapshot.exists ? (
        <InlineNotice
          tone="warning"
          size="sm"
          role={null}
          className="items-start"
          data-testid="deployment-overwrite-notice"
          icon={
            <TriangleAlert
              aria-hidden="true"
              className="text-warning mt-0.5 h-4 w-4 shrink-0"
            />
          }
        >
          Replaces the {FILE_NAME} already at{' '}
          <code className="break-all">{snapshot.filePath}</code>. What it holds
          now is not kept.
        </InlineNotice>
      ) : (
        <p
          className="text-muted-foreground text-xs"
          data-testid="deployment-new-file"
        >
          Creates <code>{FILE_NAME}</code> at{' '}
          <code className="break-all">{snapshot.filePath}</code>.
        </p>
      )}
      <p className="text-foreground text-sm">
        From the next start on, the app makes your services match this file{' '}
        <strong>every time it starts</strong>:
      </p>
      <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
        <li>
          {autostartCount > 0
            ? `The ${autostartCount === 1 ? 'instance' : `${autostartCount} instances`} marked “Starts automatically” ${autostartCount === 1 ? 'is' : 'are'} started; every other instance stays stopped.`
            : 'No instance is running now, so none is started automatically; every instance stays stopped until you start it. Start the ones you want first, then save.'}
        </li>
        <li className="text-foreground">
          <strong>
            Instances and services that are not in the file are deleted, with
            their data
          </strong>{' '}
          — including any you add after saving, unless you save the deployment
          again.
        </li>
        <li>
          Instances in the file get its model, device and engine back at each
          start, even if you change them in the meantime.
        </li>
        <li>Ports are not saved; each start assigns them.</li>
      </ul>
      {instanceCount === 0 && (
        <InlineNotice
          tone="destructive"
          size="sm"
          role={null}
          className="items-start"
          data-testid="deployment-empty-notice"
          icon={
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0"
            />
          }
        >
          No service is added, so the file lists none: every service added later
          is removed again at the next start.
        </InlineNotice>
      )}
      <p className="text-muted-foreground text-xs">
        To stop applying it, delete the file.
      </p>
    </section>
  )
}

/**
 * Previews the current services as deployment.json, and what it does at every start, before
 * writing it. The server refuses the save if the services changed since the preview loaded.
 */
export function DeploymentDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data, isPending, isFetching, error, refetch } =
    useDeploymentSnapshot(open)
  const {
    mutate: save,
    isPending: isSaving,
    error: saveError,
    reset: resetSave,
  } = useSaveDeployment()

  const summary = data ? summarizeDeployment(data.config.services) : undefined
  const json = data ? JSON.stringify(data.config, null, 2) : ''
  const conflict = changedSnapshot(saveError) !== undefined

  const close = () => {
    resetSave()
    onOpenChange(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (next) onOpenChange(true)
    // Closing while the file is written would look like canceling it.
    else if (!isSaving) close()
  }

  const handleDownload = () => {
    if (!json) return
    downloadBlob(
      new Blob([`${json}\n`], { type: 'application/json' }),
      FILE_NAME,
    )
    toast.success(`${FILE_NAME} download started`, {
      description: 'Nothing on this machine was changed.',
    })
  }

  const handleSave = () => {
    if (!data) return
    save(data, {
      onSuccess: (snapshot) => {
        toast.success('Startup deployment saved', {
          description: `Written to ${snapshot.filePath}. The app applies it every time it starts, from the next start on.`,
        })
        close()
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Save current deployment</DialogTitle>
          <DialogDescription>
            Saves your current services as the <code>{FILE_NAME}</code> the app
            applies every time it starts. Review what it sets up and what it
            changes before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 min-h-0 flex-1 space-y-5 overflow-y-auto px-6">
          {isPending ? (
            <div className="space-y-3" role="status" aria-busy="true">
              <span className="sr-only">Loading the current deployment…</span>
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : error && !data ? (
            <InlineNotice
              tone="destructive"
              size="sm"
              className="items-start"
              data-testid="deployment-load-error"
              icon={
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
              }
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void refetch()}
                  disabled={isFetching}
                >
                  {isFetching ? (
                    <Loader aria-hidden="true" className="animate-spin" />
                  ) : (
                    <RotateCw aria-hidden="true" />
                  )}
                  Retry
                </Button>
              }
            >
              The current services could not be read:{' '}
              {describeRequestError(error)}
            </InlineNotice>
          ) : data && summary ? (
            <>
              <section
                aria-labelledby="deployment-summary-title"
                className="space-y-2"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3
                    id="deployment-summary-title"
                    className="text-foreground text-sm font-semibold"
                  >
                    What is saved
                  </h3>
                  {isFetching && (
                    <span
                      role="status"
                      className="text-muted-foreground flex items-center gap-1.5 text-xs"
                    >
                      <Loader
                        aria-hidden="true"
                        className="h-3.5 w-3.5 animate-spin"
                      />
                      Checking the current services…
                    </span>
                  )}
                </div>
                <p
                  data-testid="deployment-autostart-count"
                  className="text-foreground text-sm"
                >
                  {summary.instanceCount === 0
                    ? 'No services are added.'
                    : `${summary.autostartCount} of ${summary.instanceCount} instances start automatically`}
                </p>
                {summary.instanceCount > 0 && (
                  <DeploymentSummaryList summary={summary} />
                )}
              </section>

              <StartupConsequences
                snapshot={data}
                autostartCount={summary.autostartCount}
                instanceCount={summary.instanceCount}
              />

              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="group -ml-2 gap-1.5"
                  >
                    <FileJson aria-hidden="true" />
                    Show the file contents
                    <ChevronDown
                      aria-hidden="true"
                      className="transition-transform group-data-[state=open]:rotate-180"
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre
                    className="bg-muted/30 mt-2 max-h-64 overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed"
                    data-testid="deployment-json"
                  >
                    {json}
                  </pre>
                </CollapsibleContent>
              </Collapsible>

              <p className="text-muted-foreground flex items-start gap-2 text-xs">
                <Info
                  aria-hidden="true"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
                <span>
                  <span className="text-foreground font-medium">
                    Download copy
                  </span>{' '}
                  only saves the same file through your browser. Nothing on this
                  machine changes and startup is not affected.
                </span>
              </p>
            </>
          ) : null}

          {conflict ? (
            <InlineNotice
              tone="warning"
              size="sm"
              role="alert"
              className="items-start"
              data-testid="deployment-conflict"
              icon={
                <TriangleAlert
                  aria-hidden="true"
                  className="text-warning mt-0.5 h-4 w-4 shrink-0"
                />
              }
            >
              Nothing was saved: the services changed while this was open. The
              summary now shows them as they are — review it, then save again.
            </InlineNotice>
          ) : (
            saveError && (
              <InlineNotice
                tone="destructive"
                size="sm"
                className="items-start"
                data-testid="deployment-save-error"
                icon={
                  <CircleAlert
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                }
              >
                {FILE_NAME} was not saved: {describeRequestError(saveError)}
              </InlineNotice>
            )
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleDownload}
            disabled={!data || isSaving}
            data-testid="deployment-download"
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            Download copy
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              className="gap-2"
              onClick={handleSave}
              disabled={!data || isSaving || isFetching}
              data-testid="deployment-save"
            >
              {isSaving && (
                <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
              )}
              {isSaving
                ? 'Saving…'
                : data?.exists
                  ? 'Overwrite startup deployment'
                  : 'Save as startup deployment'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
