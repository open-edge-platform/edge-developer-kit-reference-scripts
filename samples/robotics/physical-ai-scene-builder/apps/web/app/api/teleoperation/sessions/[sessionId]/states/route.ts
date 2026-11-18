// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  appendTeleoperationState,
  TeleoperationSessionError,
} from '@/lib/teleoperation/sessionManager';
import {
  type EvaluationValidationIssue,
  type ModelRandomizationRuleV1,
  type TeleoperationRobotRandomizationV1,
  type TeleoperationSourceRandomizationV1,
  validateModelRandomizationRule,
  validateTeleoperationRobotRandomization,
} from '@mujoco-studio/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

function errorResponse(error: unknown, fallback: string): Response {
  if (error instanceof TeleoperationSessionError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new TeleoperationSessionError('State parameters must be valid JSON.', 400);
    }
    const values =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as {
            seed?: unknown;
            sourceRandomization?: unknown;
            modelRandomization?: unknown;
            robotRandomization?: unknown;
          })
        : {};
    const seed = values.seed;
    if (typeof seed !== 'number' || !Number.isSafeInteger(seed)) {
      throw new TeleoperationSessionError('State seed must be a safe integer.', 400);
    }
    if (
      !values.sourceRandomization ||
      typeof values.sourceRandomization !== 'object' ||
      Array.isArray(values.sourceRandomization)
    ) {
      throw new TeleoperationSessionError('State sourceRandomization must be an object.', 400);
    }
    const modelRandomization = values.modelRandomization ?? [];
    if (!Array.isArray(modelRandomization)) {
      throw new TeleoperationSessionError('State modelRandomization must be an array.', 400);
    }
    const issues: EvaluationValidationIssue[] = [];
    modelRandomization.forEach((rule, index) =>
      validateModelRandomizationRule(rule, `modelRandomization[${index}]`, issues),
    );
    if (values.robotRandomization !== undefined) {
      validateTeleoperationRobotRandomization(
        values.robotRandomization,
        'robotRandomization',
        issues,
      );
    }
    if (issues.length > 0) {
      // `issues` lets the client list each problem; `error` stays a readable one-line summary.
      return Response.json(
        {
          error: `The randomization rules have ${issues.length} problem${issues.length === 1 ? '' : 's'}.`,
          issues: issues.map((issue) => `${issue.path}: ${issue.message}`),
        },
        { status: 400 },
      );
    }
    const result = await appendTeleoperationState(
      sessionId,
      seed,
      values.sourceRandomization as TeleoperationSourceRandomizationV1,
      modelRandomization as ModelRandomizationRuleV1[],
      values.robotRandomization as TeleoperationRobotRandomizationV1 | undefined,
    );
    return Response.json(result.session, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'The randomized state could not be appended.');
  }
}
