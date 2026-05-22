// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
export interface APIResponse {
  status: boolean;
  url: string;
  data?: any;
  message?: string;
  detail?: any;
  text?: string
}
