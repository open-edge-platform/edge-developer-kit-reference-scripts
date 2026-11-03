// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CategoryDefinition, ServiceDefinition } from "@/services";
import { publicEnv } from "@/lib/public-config";
import { apiDelete, apiGet, apiPoll, apiPost, apiPostBlob, apiUpload } from "./client";

export type IdentityMethod = "face" | "fingerprint" | "dob";
export type PaymentMethod = "card" | "qr" | "cash";

export type IdentityDocumentType = "mykad" | "passport" | "patientCard" | "appointmentSlip";

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
  /** A card in the reader is matched by face; a scanned code only finds the record, so the holder confirms their date of birth. */
  secondFactor: "face" | "dob";
  /** Last characters of the MRN, for a scanned code — the name stays hidden until the date of birth matches. */
  mrnHint?: string;
  /** Set when the scan was an appointment slip: the visit to check in for. */
  appointmentReference?: string;
  /** Read off a page in the document scanner rather than a card or a code. */
  via?: "paper";
  detectedAt: string;
};

/** What the scan intake made of a code: a scan that opens a record is passed on to the identity watch. */
export type ScanIntake = { kind: "patientCard" | "appointmentSlip" };

export type CitizenProfile = {
  name: string;
  nationalId: string;
  country: string;
  age: number;
  dateOfBirth: string;
  phone: string;
  email: string;
  address: string;
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

export type ApplicationStatus = "in_review" | "officer_review" | "on_hold" | "approved";

export type ApplicationReceipt = {
  caseId: string;
  serviceId: string;
  status: ApplicationStatus;
  /** Registry-driven explanation when the case needs an officer or is held. */
  statusReason?: string;
  submittedAt: string;
  /** Answers the server added while filing — the queue number, an appointment slip's code. */
  data?: Record<string, string>;
};

/** Saved drafts are resumable; pending entries are submitted cases in review. */
export type KioskRequestKind = "saved" | "pending";

export type KioskRequestStatus = ApplicationStatus | "saved";

/** One row of the unified requests list (saved drafts + pending cases). */
export type KioskRequest = {
  kind: KioskRequestKind;
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
export function findPendingDuplicate(
  requests: KioskRequest[],
  service: Pick<ServiceDefinition, "oncePerDay">,
): KioskRequest | undefined {
  const today = new Date().toDateString();
  return requests.find(
    (r) =>
      r.kind === "pending" &&
      (r.status === "in_review" || r.status === "officer_review") &&
      (!service.oncePerDay || new Date(r.updatedAt).toDateString() === today),
  );
}

export type SavedRequestReceipt = {
  requestId: string;
  serviceId: string;
  serviceLabel: string;
  stepId: string;
  savedAt: string;
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
    /** The lip-synced assistant. Optional like voice: "off" leaves the chat
     *  without an avatar tile, "unreachable" shows it as not connected, and
     *  either way replies play from the page. */
    avatar?: ServiceHealthStatus;
    /** "off" when no scanner is fitted and the screen offers simulated scans. */
    barcode?: ServiceHealthStatus;
    /** "off" when the card reader is simulated. */
    nfc?: ServiceHealthStatus;
    /** "off" when no receipt printer is configured, it is simulated, or printing is disabled. */
    printer?: ServiceHealthStatus;
  };
};

export function getServiceHealth() {
  return apiGet<ServiceHealthReport>("/health");
}

/** escpos: the kiosk prints cards and slips itself; mock: it pretends to; off: Print is the browser's. */
export type PrinterDriver = "escpos" | "mock" | "off";

export function getPrinterDriver() {
  return apiGet<{ driver: PrinterDriver }>("/print");
}

/** Prints the patient card or appointment slip an MRN or slip code resolves to. */
export function printCode(code: string) {
  return apiPost<{ printed: "patientCard" | "appointmentSlip" }>("/print", { code });
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
  dateOfBirth?: string,
) {
  return apiPost<IdentityVerification>("/identity/verify", {
    method,
    documentNumber,
    ...(image ? { image } : {}),
    ...(dateOfBirth ? { dateOfBirth } : {}),
  });
}

/** Long-poll for whichever arrives first: a card in the reader or a scanned code. Null when neither came. */
export function watchIdentityDocument(signal?: AbortSignal) {
  return apiPoll<IdentityDocument>("/identity/document?watch=1", signal);
}

/** Long-poll for a code the server's own scanner read, left waiting for the sign-in screen. Null when none came. */
export function watchScannedCode(signal?: AbortSignal) {
  return apiPoll<{ heard: true }>("/identity/scan", signal);
}

/** A keyboard-wedge scan or a typed MRN; `simulate` stands in a card or slip when no scanner is fitted. */
export function submitScan(input: { code: string } | { simulate: "card" | "slip" }) {
  return apiPost<ScanIntake>("/identity/scan", input);
}

/** How this terminal reads a page held up to identify — see src/app/api/_lib/identity-paper.ts. */
export type PaperMode = "sensor" | "button" | "simulated" | "off";

export function getPaperMode() {
  return apiGet<{ mode: PaperMode }>("/identity/paper");
}

/** Long-poll for paper in the feeder; null when none came. `rearm` waits for the last page to be taken out first. */
export function watchPaper(rearm: boolean, signal?: AbortSignal) {
  return apiPoll<{ fed: true }>(`/identity/paper?watch=1${rearm ? "&rearm=1" : ""}`, signal);
}

/** Scan and read the page in the feeder; the record it names reaches the identity watch. */
export function readPaper() {
  return apiPost<{ found: "mrn" | "id" }>("/identity/paper", {});
}

/**
 * How supporting documents are captured: tap-to-pick file upload (default),
 * an attached scanner the backend drives with `scanimage`, or "mock" — the
 * kiosk supplies stand-in paperwork itself. Both scanner and mock need no
 * file picker, which is what lets the assistant kiosk stay hands-free.
 */
export type DocumentSource = "upload" | "scanner" | "mock";

export function documentSource(): DocumentSource {
  const source = publicEnv("NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE");
  return source === "scanner" || source === "mock" ? source : "upload";
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

export function getFeeQuote(serviceId: string, data: Record<string, string> = {}) {
  const params = new URLSearchParams({ serviceId, ...data });
  return apiGet<FeeQuote>(`/fees?${params}`);
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

/** The citizen's earlier case for a once-per-citizen service, if any. */
export function getPriorCase(serviceId: string, documentNumber: string) {
  const params = new URLSearchParams({ serviceId, documentNumber });
  return apiGet<{ prior: { caseId: string; status: string; submittedAt: string } | null }>(
    `/applications/prior?${params}`,
  );
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

export type Appointment = {
  reference: string;
  department: string;
  doctor: string;
  doctorId?: string;
  date: string;
  time: string;
  source: "scheduled" | "booked";
};

export type CheckIn = {
  caseId: string;
  queueNumber: string;
  department: string;
  appointmentReference: string;
  checkedInAt: string;
};

export function getAppointmentsToday(documentNumber: string) {
  return apiGet<{ appointments: Appointment[]; checkedIn: CheckIn | null; checkIns: CheckIn[] }>(
    `/appointments?documentNumber=${encodeURIComponent(documentNumber)}`,
  );
}

/** "YYYY-MM-DD HH:mm" keys of a doctor's slots someone has already booked. */
export function getTakenSlots(doctorId: string) {
  return apiGet<{ taken: string[] }>(`/appointments?doctorId=${encodeURIComponent(doctorId)}`);
}
