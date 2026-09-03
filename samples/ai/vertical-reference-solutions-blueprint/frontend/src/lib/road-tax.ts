// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * JPJ private saloon road tax schedule (Peninsular Malaysia): a flat base
 * rate up to 1,600cc, then a base plus a progressive per-cc charge. Shared
 * by the server fee quote and the kiosk UI so both always agree.
 */
export function annualRoadTax(engineCc: number): number {
  if (engineCc <= 1000) return 20;
  if (engineCc <= 1200) return 55;
  if (engineCc <= 1400) return 70;
  if (engineCc <= 1600) return 90;
  if (engineCc <= 1800) return 200 + (engineCc - 1600) * 0.4;
  if (engineCc <= 2000) return 280 + (engineCc - 1800) * 0.5;
  if (engineCc <= 2500) return 380 + (engineCc - 2000) * 1.0;
  if (engineCc <= 3000) return 880 + (engineCc - 2500) * 2.5;
  return 2130 + (engineCc - 3000) * 4.5;
}

/** Road tax for a renewal period; a half-year renewal costs half the annual rate. */
export function roadTaxFor(engineCc: number, periodMonths: number): number {
  const annual = annualRoadTax(engineCc);
  return Math.round(periodMonths === 6 ? annual / 2 : annual);
}
