// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, delay, param } from "../_lib/http";
import { findVehiclesByDocument } from "../_lib/vehicles";

/** Vehicles registered to the verified citizen (JPJ ownership lookup). */
export async function GET(req: Request) {
  const documentNumber = param(req, "documentNumber");
  if (!documentNumber) return badRequest("documentNumber is required");

  const vehicles = await findVehiclesByDocument(documentNumber);
  await delay(600);
  return Response.json({
    vehicles: vehicles.map(({ plateNumber, model, year, engineCc, roadTaxExpiry }) => ({
      plateNumber,
      model,
      year,
      engineCc,
      roadTaxExpiry,
    })),
  });
}
