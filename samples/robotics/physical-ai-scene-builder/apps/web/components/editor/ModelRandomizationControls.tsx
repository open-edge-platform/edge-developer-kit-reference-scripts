// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { TeleoperationRandomizationSampleV1 } from '@mujoco-studio/types';

import type { ModelRandomizationPreset } from '@/lib/generation/modelRandomizationPresets';

interface ModelRandomizationControlsProps {
  /** Distinguishes the Generate and Evaluate controls for assistive technology and tests. */
  context: 'Generate' | 'Evaluate';
  preset: ModelRandomizationPreset;
  onPresetChange: (preset: ModelRandomizationPreset) => void;
  customRules: string;
  onCustomRulesChange: (value: string) => void;
  error: string | null;
  disabled: boolean;
}

/** Appearance and physics randomization preset select, with a JSON editor for custom rules. */
export function ModelRandomizationControls({
  context,
  preset,
  onPresetChange,
  customRules,
  onCustomRulesChange,
  error,
  disabled,
}: ModelRandomizationControlsProps) {
  return (
    <div className="space-y-1.5">
      <label
        className="flex items-center justify-between gap-2 text-[10px] text-muted"
        title="Colour, lighting, and camera changes appear in recorded camera images, not in the viewport. Physics changes (mass, friction) apply to the task object."
      >
        <span>Appearance & physics</span>
        <select
          aria-label={`${context} model randomization preset`}
          className="h-7 border border-border bg-background px-2 text-[10px] text-foreground"
          disabled={disabled}
          value={preset}
          onChange={(event) => onPresetChange(event.target.value as ModelRandomizationPreset)}
        >
          <option value="off">Off</option>
          <option value="mild">Mild</option>
          <option value="strong">Strong</option>
          <option value="custom">Custom rules</option>
        </select>
      </label>
      {preset === 'custom' && (
        <textarea
          aria-label={`${context} custom model randomization rules`}
          className="h-28 w-full resize-y border border-border bg-background p-2 font-mono text-[10px] text-foreground"
          disabled={disabled}
          spellCheck={false}
          value={customRules}
          onChange={(event) => onCustomRulesChange(event.target.value)}
        />
      )}
      {error && <p className="text-[10px] text-danger">{error}</p>}
      {preset !== 'off' && (
        <p className="text-[10px] text-muted">Changes show in recorded camera images.</p>
      )}
    </div>
  );
}

function formatSample(sample: TeleoperationRandomizationSampleV1): string {
  if (sample.selected) return sample.selected;
  return sample.values.map((value) => value.toFixed(3)).join(', ');
}

/** Read-only list of the model randomization samples applied to a generated scene state. */
export function ModelSampleList({
  samples,
}: {
  samples: readonly TeleoperationRandomizationSampleV1[];
}) {
  if (samples.length === 0) return null;
  return (
    <section aria-label="Applied model randomization">
      <dl className="space-y-0.5 text-[9px] text-muted">
        {samples.map((sample, index) => (
          <div className="flex justify-between gap-2" key={`${sample.kind ?? 'rule'}-${index}`}>
            <dt>
              {sample.kind ?? 'rule'} · {sample.target}
            </dt>
            <dd className="truncate text-foreground">{formatSample(sample)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
