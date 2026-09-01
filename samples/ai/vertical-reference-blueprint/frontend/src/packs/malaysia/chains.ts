// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { chain as roadtax } from "./services/transport-licensing/vehicle-traffic-services/vehicle-registration-renewal-road-tax/chain";
import { chain as fine } from "./services/transport-licensing/vehicle-traffic-services/traffic-fine-payment/chain";
import { chain as dl_renew } from "./services/transport-licensing/driving-license-services/driving-license-renewal-replacement/chain";
import { chain as dl_new } from "./services/transport-licensing/driving-license-services/new-driving-license-application/chain";
import { chain as idcard } from "./services/identity-services/national-id-card-services/citizen-id-issuance-replacement/chain";
import { chain as police } from "./services/certificates-records/police-clearance/police-clearance-certificate-request/chain";
import { chain as birth } from "./services/civil-registration/birth-registration/birth-certificate-request/chain";
import { chain as marriage } from "./services/civil-registration/marriage-registration/marriage-certificate-application/chain";
import { chain as welfare } from "./services/family-social-services/social-assistance/welfare-benefit-application/chain";
import { chain as address } from "./services/residence-address/address-update/address-change-request/chain";

// SERVER-ONLY — never import from client code (go via src/packs/index.server.ts).
// Static imports, not require.context: a second context over `services/` would
// collide with the catalog's under Turbopack.
export const chains: Record<string, ChainSpec> = {
  roadtax,
  fine,
  dl_renew,
  dl_new,
  idcard,
  police,
  birth,
  marriage,
  welfare,
  address,
};
