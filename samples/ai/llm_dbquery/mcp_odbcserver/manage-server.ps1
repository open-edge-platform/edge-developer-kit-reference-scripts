# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

param (
    [Parameter(Mandatory=$true)]
    [ValidateSet("start", "stop", "status", "restart")]
    [string]$Command,

    [ValidateSet("manu", "retail")]
    [string]$Domain
)

$ServerPath = Join-Path $PSScriptRoot "server.py"

switch ($Command) {
    "start" {
        if (-not $Domain) {
            Write-Error "❌ -Domain is required for 'start'. Use: -Domain manu  or  -Domain retail"
            exit 1
        }
        python $ServerPath start --domain $Domain --json
    }
    "stop" {
        python $ServerPath stop --json
    }
    "status" {
        python $ServerPath status --json
    }
    "restart" {
        if (-not $Domain) {
            Write-Error "❌ -Domain is required for 'restart'. Use: -Domain manu  or  -Domain retail"
            exit 1
        }
        python $ServerPath stop --json
        Start-Sleep -Seconds 2
        python $ServerPath start --domain $Domain --json
    }
}