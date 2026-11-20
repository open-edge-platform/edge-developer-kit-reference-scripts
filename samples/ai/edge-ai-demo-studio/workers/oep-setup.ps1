# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Old name of upstream-setup.ps1 (its catalogue, oep-services.json, is now upstream.json): the
# catalogue lists plain git sources as well as OEP microservices. Kept so commands and branches
# written before the rename keep working; delete once nothing calls it.

Write-Warning "oep-setup.ps1 is now upstream-setup.ps1."
$global:LASTEXITCODE = 0
& (Join-Path $PSScriptRoot "upstream-setup.ps1") @args
exit $LASTEXITCODE
