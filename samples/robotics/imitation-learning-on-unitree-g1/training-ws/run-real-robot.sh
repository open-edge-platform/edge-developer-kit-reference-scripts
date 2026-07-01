#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

python eval-robot.py \
  --robot-net eno1 \
  --robot-config configs/g1.yaml \
  --robot-host localhost \
  --robot-request-port 60000 \
  --model-dir data/outputs/training/act/checkpoints/last/pretrained_model \
  --temporal-ensemble-coeff 0.01 \
  --model-device xpu \
  --plot 
