// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getService, type ServiceDefinition } from "@/services";
import { countOf } from "@/lib/format";
import { badRequest, delay } from "../_lib/http";
import { cmsCreate, cmsDelete, cmsFindOne, cmsUpdate } from "../_lib/cms";
import { findCitizenByDocument, updateCitizenAddress, type CitizenDoc } from "../_lib/citizens";
import {
  findLicensesByDocument,
  isLicenseCancelled,
  issueProbationaryLicense,
  reissueLicenseAs,
  renewLicense,
  type LicenseDoc,
} from "../_lib/licenses";
import { findVehicleByPlate, renewRoadTax } from "../_lib/vehicles";
import { newCaseId } from "../_lib/registry";

type ApplicationStatus = "in_review" | "officer_review" | "on_hold";

type Outcome = {
  status: ApplicationStatus;
  statusReason?: string;
  /** Registry write-back executed only when the application is accepted. */
  apply?: () => Promise<unknown>;
};

const OK: Outcome = { status: "in_review" };

function onHold(statusReason: string): Outcome {
  return { status: "on_hold", statusReason };
}

/** Outstanding summonses blacklist a citizen from license and road tax renewal. */
function blacklisted(citizen: CitizenDoc): Outcome | null {
  if (!citizen.hasOutstandingFines) return null;
  return onHold(
    `${countOf(citizen.unpaidFineCount ?? 0, "unpaid summons", "unpaid summonses")} on record — settle them at the Traffic Fine Payment service to lift the blacklist.`,
  );
}

async function licenseRenewalOutcome(
  citizen: CitizenDoc,
  data: Record<string, string>,
): Promise<Outcome> {
  const licenses = await findLicensesByDocument(citizen.citizenId);
  const license = licenses.find((l) => l.licenseClass === data.licenseClass);
  if (!license) {
    return onHold(
      `No class ${data.licenseClass || "?"} license is registered under this identity — a license must exist before it can be renewed or replaced.`,
    );
  }
  if (isLicenseCancelled(license)) {
    return onHold(
      `The class ${license.licenseClass} license expired more than 3 years ago and is cancelled under the Road Transport Act — retake KPP02/KPP03 at a driving institute.`,
    );
  }
  const hold = blacklisted(citizen);
  if (hold) return hold;
  if (data.requestType === "renewal") {
    const years = Number(data.duration || "1");
    return { ...OK, apply: () => renewLicense(license, years) };
  }
  return OK; // replacement re-prints the card; validity is unchanged
}

/**
 * A new application must be for a class the citizen doesn't actively hold.
 * Cancelled licenses (> 3 years expired) don't count as held — that class
 * must be re-applied for after retaking the tests. D covers DA, and a DA
 * holder applying for D has their existing row converted, so a citizen never
 * ends up holding D and DA at the same time.
 */
function newLicenseOutcome(citizen: CitizenDoc, licenses: LicenseDoc[], licenseClass: string): Outcome {
  const active = licenses.filter((l) => !isLicenseCancelled(l));
  const held = new Set<string>(active.map((l) => l.licenseClass));
  if (held.has(licenseClass)) {
    return onHold(`A class ${licenseClass} license is already registered under this identity — use the renewal service.`);
  }
  if (licenseClass === "DA" && held.has("D")) {
    return onHold("A class D license is already registered — it covers automatic cars, so a DA license cannot be issued.");
  }
  const reusableRow =
    licenses.find((l) => l.licenseClass === licenseClass) ??
    (licenseClass === "D" ? active.find((l) => l.licenseClass === "DA") : undefined);
  return {
    ...OK,
    apply: () =>
      reusableRow
        ? reissueLicenseAs(reusableRow, licenseClass as LicenseDoc["licenseClass"])
        : issueProbationaryLicense(citizen.id, citizen.citizenId, licenseClass as LicenseDoc["licenseClass"]),
  };
}

async function roadTaxOutcome(citizen: CitizenDoc, data: Record<string, string>): Promise<Outcome> {
  const vehicle = data.plate ? await findVehicleByPlate(data.plate) : null;
  if (!vehicle || vehicle.documentNumber !== citizen.citizenId) {
    return onHold(
      `Vehicle ${data.plate || "?"} is not registered under this identity in the JPJ ownership records.`,
    );
  }
  const hold = blacklisted(citizen);
  if (hold) return hold;
  return { ...OK, apply: () => renewRoadTax(vehicle, Number(data.period ?? "12")) };
}

/** JKM scheme rules: BWE needs age 60+, OKU schemes need OKU registration, BKK needs children. */
function welfareOutcome(citizen: CitizenDoc, scheme: string): Outcome {
  const age = citizen.age ?? 0;
  if (scheme === "bwe" && age < 60) {
    return onHold("BWE senior-citizen aid requires age 60 or above per the registry record.");
  }
  if ((scheme === "btb" || scheme === "epoku") && !citizen.isOku) {
    return onHold("No JKM OKU registration is on record — register as OKU before applying for this scheme.");
  }
  if (scheme === "bkk" && (citizen.childrenUnder18 ?? 0) === 0) {
    return onHold("No dependent children under 18 are on record for the BKK child-aid scheme.");
  }
  return OK;
}

function myKadOutcome(citizen: CitizenDoc, data: Record<string, string>): Outcome {
  if (citizen.country !== "Malaysia") {
    return onHold("MyKad services are available to Malaysian citizens only — foreign nationals should contact the Immigration Department.");
  }
  if (data.caseType === "lost") {
    // Filing the loss bumps the registry's loss counter, which sets the fee
    // tier for any future replacement.
    return {
      ...OK,
      apply: () =>
        cmsUpdate<CitizenDoc>("citizens", citizen.id, {
          idCardLossCount: (citizen.idCardLossCount ?? 0) + 1,
        }),
    };
  }
  return OK;
}

/**
 * A citizen with a case for the same service still under review cannot file
 * it again — the duplicate is held with a pointer to the existing case.
 * Repeatable services (fine payment) are exempt.
 */
async function duplicateOutcome(
  service: ServiceDefinition,
  citizen: CitizenDoc | null,
): Promise<Outcome | null> {
  if (!citizen || service.repeatable) return null;
  const pending = await cmsFindOne<{ caseId: string }>("applications", {
    serviceId: { equals: service.id },
    citizen: { equals: citizen.id },
    status: { in: "in_review,officer_review" },
  });
  if (!pending) return null;
  return onHold(
    `Case ${pending.caseId} for this service is already pending review — track it under Requests on the home screen instead of submitting again.`,
  );
}

/**
 * Registry-aware review outcome per service: eligibility is validated against
 * the citizen's actual records, and accepted applications write their result
 * back (license issued/extended, road tax expiry bumped, address updated…).
 */
async function reviewOutcome(
  service: ServiceDefinition,
  citizen: CitizenDoc | null,
  data: Record<string, string>,
): Promise<Outcome> {
  if (!citizen) return OK;
  switch (service.id) {
    case "police":
      return citizen.criminalRecord?.officerReviewRequired
        ? {
            status: "officer_review",
            statusReason:
              "An open case on this record requires a PDRM officer to vet the certificate before release.",
          }
        : OK;
    case "dl_renew":
      return licenseRenewalOutcome(citizen, data);
    case "dl_new":
      return newLicenseOutcome(citizen, await findLicensesByDocument(citizen.citizenId), data.licenseClass ?? "");
    case "roadtax":
      return roadTaxOutcome(citizen, data);
    case "welfare":
      return welfareOutcome(citizen, data.scheme ?? "");
    case "idcard":
      return myKadOutcome(citizen, data);
    case "marriage":
      if (citizen.religion === "Islam") {
        return onHold(
          "Registry records show the applicant is Muslim — civil marriage under Act 164 applies to non-Muslims only. Please apply through the State Islamic Religious Department (Syariah).",
        );
      }
      return citizen.maritalStatus === "married"
        ? onHold("NRD records show an existing registered marriage — a new KC02 notice cannot be filed at the kiosk.")
        : OK;
    case "address":
      return data.newAddress
        ? { ...OK, apply: () => updateCitizenAddress(citizen, data.newAddress) }
        : OK;
    default:
      return OK;
  }
}

export async function POST(req: Request) {
  const { serviceId, paymentId, documentNumber, data } = (await req.json().catch(() => ({}))) as {
    serviceId?: string;
    paymentId?: string;
    documentNumber?: string;
    data?: Record<string, string>;
  };
  const service = serviceId ? getService(serviceId) : null;
  if (!service) return badRequest("unknown serviceId");

  const citizen = documentNumber ? await findCitizenByDocument(documentNumber) : null;
  const { status, statusReason, apply } =
    (await duplicateOutcome(service, citizen)) ?? (await reviewOutcome(service, citizen, data ?? {}));
  if (apply) await apply();

  await delay();
  const caseId = newCaseId();
  const submittedAt = new Date().toISOString();

  await cmsCreate("applications", {
    caseId,
    serviceId: service.id,
    serviceLabel: service.label,
    citizen: citizen?.id ?? null,
    status,
    statusReason: statusReason ?? null,
    data: data ?? {},
    paymentId: paymentId ?? null,
    submittedAt,
  });

  // The submission supersedes any draft saved mid-flow for this service.
  if (documentNumber) {
    const draft = await cmsFindOne<{ id: number }>("requests", {
      serviceId: { equals: service.id },
      documentNumber: { equals: documentNumber.trim().toUpperCase() },
    });
    if (draft) await cmsDelete("requests", draft.id).catch(() => {});
  }

  return Response.json({ caseId, serviceId: service.id, status, statusReason, submittedAt });
}
