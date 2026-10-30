// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { components } from "../api-schema"

export type { components } from "../api-schema"

export type Asset = components["schemas"]["AssetView"]
export type AssetFile = components["schemas"]["AssetFileView"]
export type Job = components["schemas"]["Job"]
export type JobKind = components["schemas"]["JobKind"]
export type JobSubmission = components["schemas"]["JobSubmission"]
export type Device = NonNullable<JobSubmission["device"]>
export type Run = components["schemas"]["RunView"]