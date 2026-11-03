// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { HEALTH_ANSWERS } from "@/hospital/data";

export const HEALTH_QUESTION = "What would you like to know?";
export const HEALTH_EXAMPLE = "e.g. What are the warning signs of dengue?";

const POPULAR = ["fever", "flu", "dengue", "blood-pressure", "diabetes", "healthy-eating", "quit-smoking", "mental-health"];

export const POPULAR_HEALTH_TOPICS = POPULAR.flatMap((id) => HEALTH_ANSWERS.filter((t) => t.id === id));
