// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Sample } from '../types'
import { RoboticsAiDemo } from './demo'

export const sample: Sample = {
  id: 'robotics-ai',
  title: 'Robotics AI',
  description:
    'A demo showcasing the capabilities of Robotics AI, including real-time object detection and manipulation.',
  longDescription:
    'Robotics AI integrates advanced computer vision and machine learning techniques to enable robots to perceive and interact with their environment. This demo highlights features such as object detection, manipulation, and task execution in real-time.',
  category: ['Creative'],
  dependencies: [
    {
      serviceId: 'robotics-ai',
      role: 'required',
      capabilityKey: 'robotic_control',
      impactText: 'Robotic control will be disabled.',
    },
    {
      serviceId: 'text-generation',
      role: 'required',
      defaultDevice: 'GPU',
    },
    {
      serviceId: 'speech-to-text',
      role: 'required',
      capabilityKey: 'voice_input',
      impactText: 'Voice input will be disabled.',
    },
  ],
  tags: ['Robotics', 'VLM', 'Object Segmentation', 'Speech-to-Text'],
  supportedOS: ['linux'],
  demo: {
    type: 'component',
    component: RoboticsAiDemo,
  },
}
