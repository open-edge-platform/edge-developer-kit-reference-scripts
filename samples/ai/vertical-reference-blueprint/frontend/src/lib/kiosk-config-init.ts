// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Side-effect import: reads config.yaml into process.env.
 *
 * Import this FIRST, before any module that reads process.env while it is
 * being evaluated. Static imports run in source order, so the import line has
 * to come before the others for the settings to be in place in time.
 */
import { applyKioskConfig } from "./kiosk-config";

applyKioskConfig();
