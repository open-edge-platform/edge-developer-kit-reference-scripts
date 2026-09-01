// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CategoryDefinition } from "@/services";
import { apiDelete, apiGet, apiPost, apiPostBlob, apiUpload } from "./client";

export type IdentityMethod = "face" | "fingerprint";
export type PaymentMethod = "card" | "qr" | "cash";

export type IdentityDocumentType = "mykad" | "passport";

/** ID document reported by the card/passport reader peripheral. */
export type IdentityDocument = {
  documentType: IdentityDocumentType;
  documentNumber: string;
  /** Holder name from the registry — shown on screen instead of the ID number. */
  holderName: string;
  /**
   * Serial of the card that was presented. Synthetic (a "MOCK…" value) when no
   * reader answered and the kiosk stood a citizen in.
   */
  cardUid: string;
  /** True when no reader answered — the citizen below was stood in, not read. */
  simulated: boolean;
  /** Driver name of the reader that read the card; absent on a stood-in read. */
  reader?: string;
  detectedAt: string;
};

export type CitizenProfile = {
  name: string;
  nationalId: string;
  country: string;
  age: number;
  dateOfBirth: string;
  phone: string;
  email: string;
  address: string;
  race: "Malay" | "Chinese" | "Indian" | "Other";
  /** Muslims marry via the Syariah system — Act 164 civil marriage is non-Muslim only. */
  religion: "Islam" | "Buddhist" | "Christian" | "Hindu" | "Other";
  /** NRD civil status — an existing marriage blocks a new KC02 notice. */
  maritalStatus: "single" | "married";
  /** Registry facts used by service steps to gate options. */
  monthlyIncome: number;
  isOku: boolean;
  childrenUnder18: number;
  idCardLossCount: number;
  outstandingFines: { count: number; total: number };
  requiresOfficerReview: boolean;
};

/**
 * How the face check actually resolved. `checked: false` means the real match
 * never ran — no face service configured, or no camera frame to send it — and
 * the kiosk fell back to its simulated scan. A check that ran and failed never
 * gets this far: the request is rejected instead.
 */
export type FaceMatchReport =
  | { checked: true; similarity: number; threshold: number }
  | { checked: false; reason: string };

export type IdentityVerification = {
  method: IdentityMethod;
  documentNumber: string;
  verifiedAt: string;
  faceMatch: FaceMatchReport;
  profile: CitizenProfile;
};

/**
 * Outcome of the check on a captured document. "unverified" means the check
 * could not run — OCR or the model was unavailable, or the page carried no
 * readable text. It is never a pass: only "accepted" satisfies a requirement.
 */
export type DocumentStatus = "accepted" | "rejected" | "unverified";

/** AI verdict on a captured document. */
export type DocumentAnalysis = {
  status: DocumentStatus;
  /** Right kind of document, even if it names another holder. */
  typeMatches: boolean;
  documentType: string;
  holderName: string | null;
  /** Address read off the document, for services that register a new address. */
  address: string | null;
  summary: string;
};

export type UploadedDocument = {
  documentId: string;
  fileName: string;
  /** Document title read from the uploaded PDF's metadata, when present. */
  title: string | null;
  pages: number;
  sizeKb: number;
  uploadedAt: string;
  /** Null only on drafts saved before verdicts carried a status; treated as
   *  unverified, so the document has to be captured again. */
  analysis: DocumentAnalysis | null;
};

export type FeeQuote = {
  serviceId: string;
  currency: string;
  serviceFee: number;
  processingFee: number;
  total: number;
};

export type PaymentReceipt = {
  paymentId: string;
  serviceId: string;
  method: PaymentMethod;
  amount: number;
  currency: string;
  paidAt: string;
};

export type ApplicationStatus = "in_review" | "officer_review" | "on_hold";

export type ApplicationReceipt = {
  caseId: string;
  serviceId: string;
  status: ApplicationStatus;
  /** Registry-driven explanation when the case needs an officer or is held. */
  statusReason?: string;
  submittedAt: string;
};

/** Saved drafts are resumable; pending entries are submitted cases in review. */
export type KioskRequestKind = "saved" | "pending";

export type KioskRequestStatus = ApplicationStatus | "saved";

/** One row of the unified requests list (saved drafts + pending cases). */
export type KioskRequest = {
  kind: KioskRequestKind;
  /** REQ-… for saved drafts, PSK-… case ids for pending applications. */
  reference: string;
  serviceId: string;
  serviceLabel: string;
  documentNumber: string | null;
  holderName: string | null;
  status: KioskRequestStatus;
  statusReason: string | null;
  /** Resume target — only present on saved drafts. */
  stepId: string | null;
  stepIndex: number | null;
  data: Record<string, string> | null;
  documents: Record<string, UploadedDocument> | null;
  updatedAt: string;
};

/**
 * The submitted case (if any) that blocks a second application for the same
 * service. Shared by the payment step's duplicate wall and the footer's
 * Save & Exit guard so the two can never disagree.
 */
export function findPendingDuplicate(requests: KioskRequest[]): KioskRequest | undefined {
  return requests.find(
    (r) => r.kind === "pending" && (r.status === "in_review" || r.status === "officer_review"),
  );
}

export type SavedRequestReceipt = {
  requestId: string;
  serviceId: string;
  serviceLabel: string;
  stepId: string;
  savedAt: string;
};

export type FineRecord = {
  summonsNo: string;
  plateNumber: string;
  offence: string;
  amount: number;
  issuedAt: string;
};

export type FineLookupResult = {
  fines: FineRecord[];
  total: number;
  currency: string;
};

export type VehicleRecord = {
  plateNumber: string;
  model: string;
  year: number;
  engineCc: number;
  roadTaxExpiry: string;
};

export type LicenseClass = "B2" | "D" | "DA";

export type LicenseRecord = {
  licenseNo: string;
  licenseClass: LicenseClass;
  licenseType: "PDL" | "CDL";
  issuedAt: string;
  expiresAt: string;
  /** Expired > 3 years: cancelled under the Road Transport Act, not renewable. */
  cancelled: boolean;
};

/** "ok" (reachable or mocked), "off" (not configured), or "unreachable". */
export type ServiceHealthStatus = "ok" | "off" | "unreachable";

export type ServiceHealthReport = {
  /** False when any configured AI service has stopped responding. */
  ok: boolean;
  services: {
    llm: ServiceHealthStatus;
    ocr: ServiceHealthStatus;
    /** OCR and the model together — the capability that checks a document.
     *  "ok" only when both halves are working. */
    verification: ServiceHealthStatus;
    /** The face check at the identity step. Optional in the same sense as
     *  voice: when it is not "ok" the kiosk falls back to a simulated scan
     *  rather than going out of service. */
    face: ServiceHealthStatus;
    /** Voice is optional: "off"/"unreachable" only hides the assistant
     *  kiosk's mic and speaker, it never takes the kiosk out of service. */
    stt: ServiceHealthStatus;
    tts: ServiceHealthStatus;
  };
};

export function getServiceHealth() {
  return apiGet<ServiceHealthReport>("/health");
}

/** Transcribe a clip recorded from the kiosk microphone. `language` is the
 *  session's current language, sent as the recognizer hint; the reply carries
 *  the language the utterance was detected to be in. */
export function transcribeSpeech(audio: Blob, fileName = "recording.webm", language?: string) {
  const form = new FormData();
  form.append("file", audio, fileName);
  if (language) form.append("language", language);
  return apiUpload<{ text: string; language?: string }>("/speech/transcribe", form);
}

/**
 * Run the attached scanner for the next document ask (scanner mode only).
 * Resolves once the citizen has fed the page in, or fails when the scan times
 * out — so a document ask can be answered without touching the screen. The
 * requirement is named because a kiosk with no scanner attached stands in the
 * right document for it instead.
 */
export function waitForScannedDocument(serviceId: string, documentId: string) {
  return apiGet<{ fileName: string; fileBase64: string; simulated?: boolean }>(
    `/documents/scan/next?serviceId=${encodeURIComponent(serviceId)}` +
      `&documentId=${encodeURIComponent(documentId)}`,
  );
}

/** Synthesize a reply for playback through the kiosk speakers. `language`
 *  picks the voice configured for it (`voice.languages`), when one is. */
export function synthesizeSpeech(text: string, language?: string) {
  return apiPostBlob("/speech/speak", { text, ...(language ? { language } : {}) });
}

export function getCatalog() {
  return apiGet<{ categories: CategoryDefinition[] }>("/catalog");
}

/** Wait for the reader peripheral to report an inserted MyKad / passport. */
export function readIdentityDocument() {
  return apiGet<IdentityDocument>("/identity/document");
}

/**
 * Match a biometric against the record for the read ID document.
 *
 * `image` is the JPEG data URL grabbed off the kiosk camera. It is omitted
 * only when there was no camera to grab one from — on that terminal the
 * server falls back to the simulated scan, because a broken camera is not
 * evidence about the person standing in front of it.
 */
export function verifyIdentity(
  method: IdentityMethod,
  documentNumber: string,
  image?: string | null,
) {
  return apiPost<IdentityVerification>("/identity/verify", {
    method,
    documentNumber,
    ...(image ? { image } : {}),
  });
}

/**
 * How supporting documents are captured: tap-to-pick file upload (default),
 * an attached scanner the backend drives with `scanimage`, or "mock" — the
 * kiosk supplies stand-in paperwork itself. Both scanner and mock need no
 * file picker, which is what lets the assistant kiosk stay hands-free.
 */
export type DocumentSource = "upload" | "scanner" | "mock";

export const DOCUMENT_SOURCE: DocumentSource =
  process.env.NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE === "scanner"
    ? "scanner"
    : process.env.NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE === "mock"
      ? "mock"
      : "upload";

export function uploadDocument(
  serviceId: string,
  documentId: string,
  file: File,
  documentNumber?: string,
  relatedName?: string,
) {
  const form = new FormData();
  form.append("serviceId", serviceId);
  form.append("documentId", documentId);
  form.append("file", file);
  if (documentNumber) form.append("documentNumber", documentNumber);
  if (relatedName) form.append("relatedName", relatedName);
  return apiUpload<UploadedDocument>("/documents", form);
}

/** Scanner mode: runs the attached scanner and returns the page it produces,
 *  verified like an upload. */
export function scanDocument(
  serviceId: string,
  documentId: string,
  documentNumber?: string,
  relatedName?: string,
) {
  return apiPost<UploadedDocument>("/documents/scan", {
    serviceId,
    documentId,
    documentNumber,
    relatedName,
  });
}

/** Mock-mode capture: the kiosk stands in the document for the requirement. */
export function mockDocument(
  serviceId: string,
  documentId: string,
  documentNumber?: string,
  relatedName?: string,
) {
  return apiPost<UploadedDocument>("/documents/mock", {
    serviceId,
    documentId,
    documentNumber,
    relatedName,
  });
}

/**
 * A captured document the citizen has not confirmed yet: held by the server,
 * shown back to them as pictures of its pages, and filed only once they say
 * it is the right paperwork. Nothing here has been stored or checked.
 */
export type DocumentCapture = {
  captureId: string;
  documentId: string;
  fileName: string;
  title: string | null;
  pages: number;
  sizeKb: number;
  capturedAt: string;
  /** True when no scanner answered and a stand-in document was used. */
  simulated: boolean;
  /** JPEG data URLs, page order. Empty on a kiosk that cannot rasterize PDFs. */
  previews: string[];
  /** How many pages `previews` could hold — the rest are captured, not shown. */
  previewLimit: number;
};

/**
 * How far a capture or its check has got. Reported by the server as it works
 * and polled by the UI, because both are one long request that would
 * otherwise say nothing at all until it finished.
 */
export type CapturePhase =
  | "waiting"
  | "scanning"
  | "packing"
  | "storing"
  | "reading"
  | "grouping"
  | "checking";

export type CaptureProgressReport = {
  phase: CapturePhase | null;
  /** Page being read, on the OCR pass through a multi-sheet document. */
  page?: number;
  pages?: number;
};

/**
 * Capture the document for a requirement without filing it. The kiosk's
 * configured source decides where the paper comes from; `file` is only for
 * upload terminals, where the citizen picked it themselves.
 */
export function captureDocument(
  serviceId: string,
  documentId: string,
  traceId: string,
  file?: File,
) {
  if (!file) {
    return apiPost<DocumentCapture>("/documents/capture", { serviceId, documentId, traceId });
  }
  const form = new FormData();
  form.append("serviceId", serviceId);
  form.append("documentId", documentId);
  form.append("traceId", traceId);
  form.append("file", file);
  return apiUpload<DocumentCapture>("/documents/capture", form);
}

/** Store and verify a capture the citizen has confirmed from its preview. */
export function confirmCapture(
  captureId: string,
  traceId: string,
  documentNumber?: string,
  relatedName?: string,
) {
  return apiPost<UploadedDocument>("/documents/capture/confirm", {
    captureId,
    traceId,
    documentNumber,
    relatedName,
  });
}

/** Throw away a capture the citizen rejected from its preview. */
export function discardCapture(captureId: string) {
  return apiDelete<{ discarded: boolean }>(
    `/documents/capture?captureId=${encodeURIComponent(captureId)}`,
  );
}

export function readCaptureProgress(traceId: string) {
  return apiGet<CaptureProgressReport>(
    `/documents/progress?traceId=${encodeURIComponent(traceId)}`,
  );
}

/** Mock-mode bytes for the assistant kiosk, to answer a document ask with. */
export function getMockDocument(serviceId: string, documentId: string) {
  return apiGet<{ fileName: string; fileBase64: string }>(
    `/documents/mock/next?serviceId=${encodeURIComponent(serviceId)}&documentId=${encodeURIComponent(documentId)}`,
  );
}

export function getFeeQuote(serviceId: string, data: Record<string, string> = {}) {
  const params = new URLSearchParams({ serviceId, ...data });
  return apiGet<FeeQuote>(`/fees?${params}`);
}

/** Vehicles registered to the verified citizen's IC / passport number. */
export function lookupVehicles(documentNumber: string) {
  const params = new URLSearchParams({ documentNumber });
  return apiGet<{ vehicles: VehicleRecord[] }>(`/vehicles?${params}`);
}

/** Driving licenses held by the verified citizen's IC / passport number. */
export function lookupLicenses(documentNumber: string) {
  const params = new URLSearchParams({ documentNumber });
  return apiGet<{ licenses: LicenseRecord[] }>(`/licenses?${params}`);
}

/** Outstanding summonses matching a summons number, plate, or IC number. */
export function lookupFines(lookupBy: string, reference: string) {
  const params = new URLSearchParams({ lookupBy, reference });
  return apiGet<FineLookupResult>(`/fines?${params}`);
}

export function capturePayment(
  serviceId: string,
  method: PaymentMethod,
  data: Record<string, string> = {},
  documentNumber?: string,
) {
  return apiPost<PaymentReceipt>("/payments", { serviceId, method, data, documentNumber });
}

/** One citizen's requests (optionally one service's) — the server refuses
 *  unscoped listings, so a document number is always required. */
export function listRequests(filter: { documentNumber?: string; serviceId?: string } = {}) {
  const params = new URLSearchParams();
  if (filter.documentNumber) params.set("documentNumber", filter.documentNumber);
  if (filter.serviceId) params.set("serviceId", filter.serviceId);
  const query = params.toString();
  return apiGet<{ requests: KioskRequest[] }>(`/requests${query ? `?${query}` : ""}`);
}

/** Save (pause) an in-progress application; overwrites the citizen's earlier draft. */
export function saveRequest(input: {
  serviceId: string;
  documentNumber: string;
  stepId: string;
  stepIndex: number;
  data: Record<string, string>;
  documents: Record<string, UploadedDocument>;
}) {
  return apiPost<SavedRequestReceipt>("/requests", input);
}

export function discardRequest(requestId: string) {
  return apiDelete<{ ok: boolean }>(`/requests?requestId=${encodeURIComponent(requestId)}`);
}

export function submitApplication(input: {
  serviceId: string;
  paymentId?: string;
  /** Verified ID number linking the case to a citizen registry record. */
  documentNumber?: string;
  data?: Record<string, string>;
}) {
  return apiPost<ApplicationReceipt>("/applications", input);
}
