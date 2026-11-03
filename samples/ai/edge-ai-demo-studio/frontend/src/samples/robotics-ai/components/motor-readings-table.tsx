// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { JointReading } from '../lib/api'

/** Each joint's range so far while the motors are calibrated. */
export function MotorReadingsTable({ readings }: { readings: JointReading[] }) {
  if (readings.length === 0) {
    return (
      <div className="bg-muted text-muted-foreground rounded-lg px-3 py-2 text-xs">
        Waiting for joint readings…
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-b">
            <th className="text-muted-foreground px-3 py-1.5 text-left font-medium">
              Joint
            </th>
            <th className="text-muted-foreground px-3 py-1.5 text-right font-medium">
              Min
            </th>
            <th className="text-muted-foreground px-3 py-1.5 text-right font-medium">
              Position
            </th>
            <th className="text-muted-foreground px-3 py-1.5 text-right font-medium">
              Max
            </th>
          </tr>
        </thead>
        <tbody>
          {readings.map((joint) => (
            <tr key={joint.name} className="border-b last:border-0">
              <td className="text-foreground px-3 py-1.5 font-medium">
                {joint.name.replace(/_/g, ' ')}
              </td>
              <td className="text-info px-3 py-1.5 text-right font-mono">
                {joint.min}
              </td>
              <td className="px-3 py-1.5 text-right font-mono">{joint.pos}</td>
              <td className="text-warning px-3 py-1.5 text-right font-mono">
                {joint.max}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
