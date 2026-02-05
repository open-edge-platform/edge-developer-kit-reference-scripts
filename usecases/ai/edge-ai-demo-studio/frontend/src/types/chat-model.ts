// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export interface OVMSModelConfig {
  [modelName: string]: {
    model_version_status: ModelVersionStatus[]
  }
}

export interface ModelVersionStatus {
  version: string
  state: string
  status: {
    error_code: string
    error_message: string
  }
}
