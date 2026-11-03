// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { ReactNode } from 'react'
import { CheckCircle2, ChevronRight, Terminal, XCircle } from 'lucide-react'
import { TONES } from '@/components/common/tones'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Prerequisites } from '../lib/api'

/** Commands to fix a failed check, selectable in one go. */
const FIX_COMMAND_CLASS =
  'bg-destructive/10 text-destructive-strong mt-2 max-w-full overflow-x-auto rounded-md px-3 py-2 font-mono text-xs leading-relaxed select-all'

/** One prerequisite check: a title row, plus fix-it instructions when it fails. */
function PrerequisiteItem({
  ok,
  title,
  children,
}: {
  ok: boolean | undefined
  title: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        ok ? TONES.success.surface : TONES.destructive.surface,
      )}
    >
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="text-success h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <XCircle className="text-destructive h-4 w-4 shrink-0" aria-hidden />
        )}
        <p className="text-sm font-medium">
          {title}
          <span className="sr-only">{ok ? ': met' : ': not met'}</span>
        </p>
      </div>
      {!ok && <div className="mt-2 pl-6">{children}</div>}
    </div>
  )
}

/** Wizard step 1, shown when a check failed: what is missing and how to fix it. */
export function PrerequisitesStep({
  prerequisites,
  onContinue,
}: {
  prerequisites: Prerequisites | undefined
  onContinue: () => void
}) {
  const allPassed =
    prerequisites?.dialout === true && prerequisites?.librealsense === true

  return (
    <div className="glass-card relative overflow-hidden rounded-xl">
      <div className="from-primary/[0.04] via-secondary/[0.02] pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent" />
      <div className="px-6 py-10 sm:px-10">
        <div className="mb-6 flex items-center gap-3">
          <div className="bg-primary/10 ring-primary/20 flex h-12 w-12 items-center justify-center rounded-xl ring-1">
            <Terminal className="text-primary h-6 w-6" aria-hidden />
          </div>
          <div>
            <h3 className="text-foreground text-lg font-semibold">
              System Prerequisites
            </h3>
            <p className="text-muted-foreground text-sm">
              Verify these requirements before connecting your robot.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <PrerequisiteItem
            ok={prerequisites?.dialout}
            title={
              <>
                User in <code className="font-mono font-bold">dialout</code>{' '}
                group
              </>
            }
          >
            <p className="text-destructive-strong text-xs leading-relaxed">
              Required to access the robot&apos;s serial port without sudo. Run
              the command below and then <strong>reboot</strong>.
            </p>
            <pre className={FIX_COMMAND_CLASS}>
              sudo usermod -aG dialout $USER
            </pre>
          </PrerequisiteItem>

          <PrerequisiteItem
            ok={prerequisites?.librealsense}
            title="Intel RealSense SDK (librealsense2)"
          >
            <p className="text-destructive-strong text-xs leading-relaxed">
              Required for the depth camera. Install following the{' '}
              <a
                href="https://github.com/IntelRealSense/librealsense/blob/master/doc/distribution_linux.md"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                official instructions
              </a>
              :
            </p>
            <pre className={FIX_COMMAND_CLASS}>
              {`sudo apt-get install apt-transport-https

sudo mkdir -p /etc/apt/keyrings
curl -sSf https://librealsense.realsenseai.com/Debian/librealsenseai.asc | \
gpg --dearmor | sudo tee /etc/apt/keyrings/librealsenseai.gpg > /dev/null

echo "deb [signed-by=/etc/apt/keyrings/librealsenseai.gpg] https://librealsense.realsenseai.com/Debian/apt-repo $(lsb_release -cs) main" | \
sudo tee /etc/apt/sources.list.d/librealsense.list

sudo apt-get update
sudo apt-get install librealsense2 librealsense2-utils`}
            </pre>
          </PrerequisiteItem>
        </div>

        <div className="mt-6 flex items-center gap-3">
          {allPassed ? (
            <p className="text-success text-sm">
              All prerequisites met. Advancing…
            </p>
          ) : (
            <Button variant="outline" onClick={onContinue} className="gap-1.5">
              Continue Anyway
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
