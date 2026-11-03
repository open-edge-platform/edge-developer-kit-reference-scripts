// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { HOSPITAL_TOPICS } from "@/hospital/data";

export const DISCOVERY_QUESTION = "What would you like to know about the hospital?";
export const DISCOVERY_EXAMPLE = "e.g. Where can I pray? When can I visit?";

const POPULAR = ["visiting", "parking", "payment", "pharmacy-hours", "cafeteria", "surau", "restrooms", "wifi"];

export const POPULAR_TOPICS = POPULAR.flatMap((id) => HOSPITAL_TOPICS.filter((t) => t.id === id));
