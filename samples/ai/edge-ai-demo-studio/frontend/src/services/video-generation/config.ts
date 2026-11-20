// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

const FASTWAN = 'FastVideo/FastWan2.2-TI2V-5B-FullAttn-Diffusers'
const WAN22 = 'Wan-AI/Wan2.2-TI2V-5B-Diffusers'
const WAN21 = 'Wan-AI/Wan2.1-T2V-1.3B-Diffusers'
const VACE = 'Wan-AI/Wan2.1-VACE-1.3B-diffusers'
const A14B = 'Wan-AI/Wan2.2-T2V-A14B-Diffusers'

export const DEFAULT_VIDEO_MODEL = FASTWAN

const OPENVINO_DEVICES = ['AUTO', 'GPU', 'CPU']

/**
 * One backend per model, the faster on an Arc Pro B60 (workers/services/video-generation/README.md,
 * "Measured"); the worker picks the backend from the device: XPU runs PyTorch, the rest OpenVINO.
 */
export const serviceConfig: ServiceConfig = {
  // The worker converts the transformer and text encoder to OpenVINO at this format on first start.
  availableWeightFormats: ['int8', 'fp16', 'int4'],
  defaultWeightFormat: 'int8',
  availableModels: [
    {
      // The 5B models are matmul-bound at 720p, where PyTorch is 3x OpenVINO's GPU plugin.
      value: FASTWAN,
      label: 'FastWan2.2 TI2V 5B · 3 steps (PyTorch XPU)',
      availableDevices: ['XPU'],
      availableWeightFormats: ['bf16'],
      backend: 'pytorch',
      weight: 'heavy',
    },
    {
      value: WAN22,
      label: 'Wan2.2 TI2V 5B (PyTorch XPU)',
      availableDevices: ['XPU'],
      availableWeightFormats: ['bf16'],
      backend: 'pytorch',
      weight: 'heavy',
    },
    {
      value: WAN21,
      label: 'Wan2.1 T2V 1.3B (OpenVINO)',
      availableDevices: OPENVINO_DEVICES,
      backend: 'openvino',
    },
    {
      // Pose to video: 26% faster per step on OpenVINO than PyTorch XPU on an Arc Pro B60.
      value: VACE,
      label: 'Wan2.1 VACE 1.3B · pose to video (OpenVINO)',
      availableDevices: OPENVINO_DEVICES,
      backend: 'openvino',
    },
    {
      // Two 14B transformers, 14 GB each at INT8: a 24 GB GPU holds one at a time (bf16 on PyTorch
      // needs about 36 GB). Hours on a CPU.
      value: A14B,
      label: 'Wan2.2 T2V A14B (OpenVINO)',
      availableDevices: ['AUTO', 'GPU'],
      backend: 'openvino',
      weight: 'heavy',
    },
  ],
  availableModelSources: [{ value: 'huggingface', label: 'Hugging Face' }],
  supportsCustomModel: false,
}

/** What a model makes, mirroring the worker's presets (`wan/presets.py`). */
export interface VideoModelSpec {
  label: string
  /** Takes a start image (Wan2.2 TI2V). */
  imageToVideo: boolean
  /** VACE: follows the poses of a driving video, and takes an image of the subject. */
  poseToVideo: boolean
  /** Distilled: a fixed few steps and no guidance, so neither is offered. */
  fixedSteps: number | null
  defaultSteps: number
  defaultGuidance: number
  fps: number
  /** Longest video, in frames (4k + 1). */
  maxFrames: number
  /**
   * VACE: a video longer than the model was trained on (5 s), or larger than 480p, is made in
   * overlapping windows (`window_tokens` in the worker's presets), each taking about a 3 s 480p
   * video's time per step.
   */
  windowed?: boolean
  /** Landscape and portrait at the trained size first, then faster, smaller ones. */
  sizes: { value: string; label: string }[]
}

const WAN22_SIZES = [
  { value: '1280x704', label: '1280 × 704 (720p)' },
  { value: '704x1280', label: '704 × 1280 (720p portrait)' },
  { value: '960x544', label: '960 × 544' },
  { value: '640x352', label: '640 × 352 (fast preview)' },
]

const WAN21_SIZES = [
  { value: '832x480', label: '832 × 480 (480p)' },
  { value: '480x832', label: '480 × 832 (480p portrait)' },
  { value: '640x368', label: '640 × 368' },
  { value: '368x640', label: '368 × 640 (portrait)' },
  { value: '480x272', label: '480 × 272 (fast preview)' },
  { value: '272x480', label: '272 × 480 (fast preview, portrait)' },
]

/** Wan2.1's sizes and two larger ones: VACE makes them in windows (slower; trained at 480p). */
const VACE_SIZES = [
  ...WAN21_SIZES.slice(0, 2),
  { value: '960x544', label: '960 × 544 (slower)' },
  { value: '544x960', label: '544 × 960 (portrait, slower)' },
  { value: '1280x720', label: '1280 × 720 (720p, much slower)' },
  { value: '720x1280', label: '720 × 1280 (720p portrait, much slower)' },
  ...WAN21_SIZES.slice(2),
]

const SPECS: Record<string, VideoModelSpec> = {
  [FASTWAN]: {
    label: 'FastWan2.2 TI2V 5B',
    imageToVideo: true,
    poseToVideo: false,
    fixedSteps: 3,
    defaultSteps: 3,
    defaultGuidance: 1,
    fps: 24,
    maxFrames: 121,
    sizes: WAN22_SIZES,
  },
  [WAN22]: {
    label: 'Wan2.2 TI2V 5B',
    imageToVideo: true,
    poseToVideo: false,
    fixedSteps: null,
    // Wan's own default is 50: 30 keeps a first try under a few minutes on a discrete GPU.
    defaultSteps: 30,
    defaultGuidance: 5,
    fps: 24,
    maxFrames: 121,
    sizes: WAN22_SIZES,
  },
  [WAN21]: {
    label: 'Wan2.1 T2V 1.3B',
    imageToVideo: false,
    poseToVideo: false,
    fixedSteps: null,
    defaultSteps: 25,
    defaultGuidance: 5,
    fps: 16,
    maxFrames: 81,
    sizes: WAN21_SIZES,
  },
  [A14B]: {
    label: 'Wan2.2 T2V A14B',
    imageToVideo: false,
    poseToVideo: false,
    fixedSteps: null,
    // Its model card's 40; the low-noise transformer's guidance stays at its own 3.
    defaultSteps: 40,
    defaultGuidance: 4,
    fps: 16,
    maxFrames: 81,
    sizes: [
      { value: '832x480', label: '832 × 480 (480p)' },
      { value: '480x832', label: '480 × 832 (480p portrait)' },
      { value: '1280x720', label: '1280 × 720 (720p)' },
      { value: '720x1280', label: '720 × 1280 (720p portrait)' },
      { value: '480x272', label: '480 × 272 (fast preview)' },
    ],
  },
  [VACE]: {
    label: 'Wan2.1 VACE 1.3B',
    imageToVideo: false,
    poseToVideo: true,
    fixedSteps: null,
    defaultSteps: 25,
    defaultGuidance: 5,
    fps: 16,
    // 30 s, made in windows past 5 s (the worker's `max_frames`).
    maxFrames: 481,
    windowed: true,
    sizes: VACE_SIZES,
  },
}

export function getVideoModelSpec(model: string): VideoModelSpec {
  return SPECS[model] ?? SPECS[DEFAULT_VIDEO_MODEL]
}

/**
 * The size to make a pose video at for a driving video of `width` x `height`: `current` turned to the
 * driving video's orientation when the model has that size turned, else its trained size in that
 * orientation. VACE sizes its own output from the driving video the same way; fitting a portrait
 * dancer into a landscape frame leaves most of it empty.
 */
export function sizeForOrientation(
  spec: VideoModelSpec,
  current: string,
  width: number,
  height: number,
): string {
  const [w, h] = current.split('x').map(Number)
  if (width === height || width > height === w > h) return current
  const values = spec.sizes.map((s) => s.value)
  const turned = `${h}x${w}`
  if (values.includes(turned)) return turned
  return (
    values.find((v) => {
      const [sw, sh] = v.split('x').map(Number)
      return sw > sh === width > height
    }) ?? current
  )
}

/** Frames for `seconds` at `fps`, rounded to the 4k + 1 the VAE takes, within the model's range. */
export function framesFor(seconds: number, spec: VideoModelSpec): number {
  const raw = Math.round(seconds * spec.fps) + 1
  const k = Math.max(1, Math.round((raw - 1) / 4))
  return Math.min(k * 4 + 1, spec.maxFrames)
}

export const demoConfig = {
  inputPlaceholder:
    'Describe the video: the subject, what happens, the camera and the light…',
  defaultInput:
    'A red fox trotting through fresh snow in a pine forest at sunrise, soft golden light, the camera slowly tracking alongside.',
  imagePromptPlaceholder:
    'Describe what happens next, starting from the image…',
  posePromptPlaceholder:
    'Optional. Who moves and where: hair, clothes, the place, the light… With a subject image, describing them keeps who they are, not only their clothes.',
  negativePlaceholder:
    "What to keep out of the video: flicker, static, blurry… (Wan's own list when empty)",
}
