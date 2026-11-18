// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The object start randomization described by the per-scene Generate settings: the main object's
 * zone plus extra objects. Generate sends it to the native sampler; Simulate turns it into reset
 * rules, so both workspaces randomize the same zones.
 */
import type {
  EvaluationRange,
  TeleoperationRandomizedObjectV1,
  TeleoperationSourceRandomizationV1,
} from '@mujoco-studio/types';

import type { GenerationSettings, RangeFields } from './generationSettings';
import { sharedZoneOffsetsCm } from './randomizationZone';

export interface PositionedBody {
  body: string;
  position: readonly number[];
}

function range(fields: RangeFields): EvaluationRange {
  const value = (text: string) => {
    const number = Number(text);
    return text.trim() !== '' && Number.isFinite(number) ? number : 0;
  };
  return [value(fields.min), value(fields.max)];
}

/**
 * Settings as a source randomization for `mainBody`. Extra objects that are missing from `bodies`
 * or are the main body are left out; shared-zone objects get offsets covering the main zone.
 */
export function sourceRandomizationFromSettings(
  settings: Pick<GenerationSettings, 'xRange' | 'yRange' | 'yawRange' | 'extraObjects'>,
  mainBody: string,
  bodies: readonly PositionedBody[],
): TeleoperationSourceRandomizationV1 {
  const xCm = range(settings.xRange);
  const yCm = range(settings.yRange);
  const yawDegrees = range(settings.yawRange);
  const position = (name: string) => bodies.find((entry) => entry.body === name)?.position;
  const mainPosition = position(mainBody);
  const objects: TeleoperationRandomizedObjectV1[] = [];
  for (const object of settings.extraObjects) {
    const objectPosition = position(object.body);
    if (object.body === mainBody || !objectPosition) continue;
    if (object.shareZone) {
      if (!mainPosition) continue;
      objects.push({
        body: object.body,
        ...sharedZoneOffsetsCm(mainPosition, objectPosition, xCm, yCm),
        yawDegrees,
      });
    } else {
      objects.push({
        body: object.body,
        xCm: range(object.xRange),
        yCm: range(object.yRange),
        yawDegrees: range(object.yawRange),
      });
    }
  }
  return {
    enabled: true,
    body: mainBody,
    xCm,
    yCm,
    yawDegrees,
    ...(objects.length > 0 ? { objects } : {}),
  };
}
