// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** What an information service shows on its `result` step, carried in flow data. */
export type ServiceResult = {
  title: string;
  intro?: string;
  rows: { label: string; value: string }[];
  note?: string;
};

/** Flow-data fields for `actions.stepCompleted("application", resultData(...))`. */
export function resultData(result: ServiceResult): Record<string, string> {
  return {
    resultTitle: result.title,
    resultIntro: result.intro ?? "",
    resultRows: JSON.stringify(result.rows),
    resultNote: result.note ?? "",
  };
}

export function readResult(data: Record<string, string>): ServiceResult {
  let rows: ServiceResult["rows"] = [];
  try {
    rows = JSON.parse(data.resultRows ?? "[]");
  } catch {
    rows = [];
  }
  return {
    title: data.resultTitle ?? "",
    intro: data.resultIntro || undefined,
    rows,
    note: data.resultNote || undefined,
  };
}

export function resultMessage(result: ServiceResult): string {
  const lines = result.rows.map((row) => `${row.label}: ${row.value}`);
  return [result.intro ?? result.title, ...lines, result.note ?? ""].filter(Boolean).join("\n");
}
