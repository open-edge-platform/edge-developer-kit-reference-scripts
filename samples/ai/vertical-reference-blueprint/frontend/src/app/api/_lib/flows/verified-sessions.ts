// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Where a guided flow remembers that somebody verified their identity.
 *
 * It is deliberately not the draft. A flow's draft is durable, resumable and
 * keyed on a request id that is printed on screen and echoed by the client —
 * everything you want of a saved application, and none of what you want of a
 * proof of identity. Keeping "this citizen passed the face check" in there
 * meant that anyone who arrived with a request id arrived already verified:
 * the id space is small enough to guess, /api/mcp is open to the terminal's
 * network, and a resumed draft skipped the card and the camera entirely.
 *
 * So the verification lives here instead, under a token minted when the check
 * actually passes. The token is handed back as part of the flow's sessionId,
 * which the client echoes exactly as before — so nothing about the client
 * changes, and a request id on its own is now just a way to find a draft,
 * which is all it ever should have been.
 *
 * Consequences worth knowing:
 *
 * - The grant is in memory, so a server restart ends every open session. The
 *   drafts survive it; the citizen verifies again to resume one, which is the
 *   right answer and the same one the touch kiosk's Requests screen gives.
 * - A grant expires. A draft picked up an hour later is somebody else's turn
 *   at the machine, not the same citizen carrying on.
 * - A grant names the document number it was issued for, so a token cannot be
 *   carried across to a draft belonging to somebody else.
 */

/** How long a verification stands before the citizen is asked again (ms). */
const TTL_MS = Number(process.env.KIOSK_VERIFICATION_TTL_MS ?? 15 * 60_000);

type Grant = { documentNumber: string; expiresAt: number };

/**
 * On `globalThis` for the same reason the card reader's monitor is: Next
 * replaces this module on every hot reload in development, and a fresh map
 * would log the citizen out mid-flow every time a file is touched.
 */
const GRANTS = Symbol.for("kiosk.flows.verifiedSessions");
type Global = { [GRANTS]?: Map<string, Grant> };

function grants(): Map<string, Grant> {
  const globals = globalThis as Global;
  return (globals[GRANTS] ??= new Map());
}

/** Drop everything that has run out, so an idle server does not accumulate. */
function prune(now: number): void {
  for (const [token, grant] of grants()) {
    if (grant.expiresAt <= now) grants().delete(token);
  }
}

/**
 * Record that this citizen has just passed the identity check, and return the
 * token that says so. Called only where the check really ran — never on the
 * strength of something the client said.
 */
export function grantVerification(documentNumber: string): string {
  const now = Date.now();
  prune(now);
  const token = crypto.randomUUID().replace(/-/g, "");
  grants().set(token, { documentNumber, expiresAt: now + TTL_MS });
  return token;
}

/** Is this token a live verification of this citizen, and nobody else? */
export function verificationHolds(
  token: string | undefined,
  documentNumber: string,
): boolean {
  if (!token) return false;
  const grant = grants().get(token);
  if (!grant) return false;
  if (grant.expiresAt <= Date.now()) {
    grants().delete(token);
    return false;
  }
  return grant.documentNumber === documentNumber;
}

/**
 * The two halves of a flow's sessionId: the request id that finds the draft,
 * and the token that says the citizen behind it verified.
 *
 * A sessionId with no token is not an error — it is a draft being resumed
 * from the touch kiosk, or one an MCP host wrote down. It finds the draft and
 * verifies nothing, which is exactly what should happen.
 */
export function splitSession(sessionId: string): { requestId: string; token?: string } {
  const separator = sessionId.indexOf(SEPARATOR);
  if (separator === -1) return { requestId: sessionId };
  return {
    requestId: sessionId.slice(0, separator),
    token: sessionId.slice(separator + 1) || undefined,
  };
}

/** The sessionId handed back to the client, carrying both halves. */
export const joinSession = (requestId: string, token: string | undefined): string =>
  token ? `${requestId}${SEPARATOR}${token}` : requestId;

/** Not a character `newRequestId` or a UUID can produce, so the split is exact. */
const SEPARATOR = "~";
