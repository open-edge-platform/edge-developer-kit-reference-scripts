# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Retail AI Suite setup is only supported on Linux.
# Run setup.sh on a Linux host instead.

param([Parameter(Mandatory=$true)][string]$AppName)
Write-Host "[retail-ai-suite/setup] ERROR: Windows is not supported for Retail AI Suite samples." -ForegroundColor Red
Write-Host "[retail-ai-suite/setup] Please run setup.sh on a Linux host."
exit 1
