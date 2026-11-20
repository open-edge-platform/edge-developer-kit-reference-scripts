// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ModelOption, ServiceConfig } from '@/services/types'

const UPSCALING_DEVICES = ['AUTO', 'CPU', 'GPU', 'NPU']
// The NPU compiler gives up on Swin2SR's and DAT2's window attention, and on AuraSR.
const NO_NPU_DEVICES = ['AUTO', 'CPU', 'GPU']
// SeedVR2 runs with PyTorch on an Intel GPU: it has no OpenVINO export.
const XPU_DEVICES = ['XPU']

export const DEFAULT_UPSCALING_MODEL = 'realesr-general-x4v3'

/** One preset of workers/services/image-upscaling/presets.py, as the demo describes it. */
export interface UpscalingModel {
  value: string
  label: string
  /** The model's own factor; the demo offers output scales up to it. */
  scale: number
  /** Fast enough for the live webcam view on a GPU. */
  realtime: boolean
  devices: string[]
  /** INT8 is offered for the Real-ESRGAN models; the others keep FP16. */
  int8: boolean
  /** Runs with PyTorch on an Intel GPU (XPU) instead of OpenVINO. */
  pytorch?: boolean
  /** Upscales still images only: the demo has no video or live webcam tab for it. */
  imageOnly?: boolean
}

const UPSCALING_MODELS: UpscalingModel[] = [
  {
    value: 'realesr-general-x4v3',
    label: 'Real-ESRGAN General x4 v3 (compact)',
    scale: 4,
    realtime: true,
    devices: UPSCALING_DEVICES,
    int8: true,
  },
  {
    value: 'realesr-animevideov3',
    label: 'Real-ESRGAN AnimeVideo x4 v3 (compact)',
    scale: 4,
    realtime: true,
    devices: UPSCALING_DEVICES,
    int8: true,
  },
  {
    value: 'RealESRGAN_x4plus',
    label: 'Real-ESRGAN x4plus',
    scale: 4,
    realtime: false,
    devices: UPSCALING_DEVICES,
    int8: true,
  },
  {
    value: 'RealESRGAN_x2plus',
    label: 'Real-ESRGAN x2plus',
    scale: 2,
    realtime: false,
    devices: UPSCALING_DEVICES,
    int8: true,
  },
  {
    value: 'RealESRGAN_x4plus_anime_6B',
    label: 'Real-ESRGAN x4plus Anime 6B',
    scale: 4,
    realtime: false,
    devices: UPSCALING_DEVICES,
    int8: true,
  },
  {
    value: 'Swin2SR_RealworldSR_X4_64_BSRGAN_PSNR',
    label: 'Swin2SR Real-world x4 (transformer)',
    scale: 4,
    realtime: false,
    devices: NO_NPU_DEVICES,
    int8: false,
  },
  {
    value: '4xNomosUni_span_multijpg',
    label: 'SPAN NomosUni x4 (fast)',
    scale: 4,
    realtime: true,
    devices: UPSCALING_DEVICES,
    int8: false,
  },
  {
    value: '4xBHI_dat2_real',
    label: 'DAT2 BHI Real x4 (transformer)',
    scale: 4,
    realtime: false,
    devices: NO_NPU_DEVICES,
    int8: false,
  },
  {
    value: 'AuraSR-v2',
    label: 'AuraSR v2 x4 (GigaGAN)',
    scale: 4,
    realtime: false,
    devices: NO_NPU_DEVICES,
    int8: false,
  },
  {
    value: 'single-image-super-resolution-1032',
    label: 'Intel Single Image Super Resolution 1032 x4 (Open Model Zoo)',
    scale: 4,
    realtime: true,
    devices: UPSCALING_DEVICES,
    int8: false,
  },
  {
    value: 'seedvr2-3b',
    label: 'SeedVR2 3B (diffusion, PyTorch XPU)',
    scale: 4,
    realtime: false,
    devices: XPU_DEVICES,
    int8: false,
    pytorch: true,
    imageOnly: true,
  },
]

/** The preset `name` names, else the default one (an instance saved before a preset was renamed). */
export function describeUpscalingModel(
  name: string | undefined,
): UpscalingModel {
  return (
    UPSCALING_MODELS.find((m) => m.value === name) ??
    UPSCALING_MODELS.find((m) => m.value === DEFAULT_UPSCALING_MODEL)!
  )
}

export const serviceConfig: ServiceConfig = {
  supportsCustomModel: false,
  availableModels: UPSCALING_MODELS.map((m): ModelOption => ({
    value: m.value,
    label: m.label,
    availableDevices: m.devices,
    backend: m.pytorch ? 'pytorch' : 'openvino',
    ...(!m.int8 && { availableWeightFormats: ['fp16'] }),
    ...(m.pytorch && { weight: 'heavy' }),
  })),
  availableDevices: UPSCALING_DEVICES,
  // Each model is exported to OpenVINO IR on first start: FP16 weights, or INT8 weights and
  // activations quantized by NNCF (2.5-4.5x faster on a CPU, 1.5x on an integrated GPU, with a
  // little added grain).
  availableWeightFormats: ['fp16', 'int8'],
  defaultWeightFormat: 'fp16',
}
