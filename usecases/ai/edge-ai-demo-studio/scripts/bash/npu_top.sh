#!/bin/bash

# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

NPU_BUSY_TIME_PATH="/sys/devices/pci0000:00/0000:00:0b.0/npu_busy_time_us"
SAMPLING_PERIOD=0.1

time_1=$(cat "$NPU_BUSY_TIME_PATH")
sleep $SAMPLING_PERIOD
time_2=$(cat "$NPU_BUSY_TIME_PATH")

delta=$(("$time_2" - "$time_1"))
utilization=$(echo "scale=2; (100 * $delta) / ($SAMPLING_PERIOD * 1000000)" | bc)

echo "${utilization}"