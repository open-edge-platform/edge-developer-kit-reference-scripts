# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

param(
    [int]$port = 5003,
    [int]$ovmsPort = 5951,
    [Parameter(Mandatory=$true)]
    [string]$embeddingModelId,
    [string]$embeddingDevice = "CPU",
    [Parameter(Mandatory=$true)]
    [string]$rerankerModelId,
    [string]$rerankerDevice = "CPU"
)

# Check if required parameters are provided
if (-not $embeddingModelId) {
    Write-Error "Error: -embeddingModelId is required"
    Write-Host "Usage: .\start.ps1 -embeddingModelId <model> -rerankerModelId <model> [-port <port>] [-ovmsPort <port>] [-embeddingDevice <device>] [-rerankerDevice <device>]"
    Write-Host "Example: .\start.ps1 -embeddingModelId 'OpenVINO/bge-base-en-v1.5-int8-ov' -rerankerModelId 'OpenVINO/bge-reranker-base-int8-ov'"
    exit 1
}

if (-not $rerankerModelId) {
    Write-Error "Error: -rerankerModelId is required"
    Write-Host "Usage: .\start.ps1 -embeddingModelId <model> -rerankerModelId <model> [-port <port>] [-ovmsPort <port>] [-embeddingDevice <device>] [-rerankerDevice <device>]"
    Write-Host "Example: .\start.ps1 -embeddingModelId 'OpenVINO/bge-base-en-v1.5-int8-ov' -rerankerModelId 'OpenVINO/bge-reranker-base-int8-ov'"
    exit 1
}

# Navigate to the directory containing main.py
$scriptPath = $PSScriptRoot
Set-Location $scriptPath

# Run main.py with uvicorn and the provided parameters
uv run main.py --port $port --ovms-port $ovmsPort --embedding-model-id $embeddingModelId --embedding-device $embeddingDevice --reranker-model-id $rerankerModelId --reranker-device $rerankerDevice