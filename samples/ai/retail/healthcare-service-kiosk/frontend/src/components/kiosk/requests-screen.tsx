// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo, useState } from "react";
import { Inbox, Info, Play, Search, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCatalog, useDiscardRequest, useRequests } from "@/hooks/use-kiosk-api";
import type { KioskFlowActions } from "@/hooks/use-kiosk-flow";
import type { IdentityVerification, KioskRequest } from "@/lib/api/kiosk";
import { formatDateTime } from "@/lib/format";
import { maskId } from "@/lib/mask";
import { IdentityGate } from "@/services/shared/steps/identity";
import type { ServiceDefinition } from "@/services/types";
import { KioskFooter } from "./kiosk-footer";
import { KioskHeader } from "./kiosk-header";
import { RequestStatusBadge } from "./request-status";
import { LoadFailed, StepError } from "./status-block";

/**
 * The citizen's own requests: applications still pending review plus saved
 * (paused) drafts, which can be resumed or discarded. The list only exists
 * behind the identity gate — the visitor verifies who they are first, and
 * only requests belonging to that verified document number are fetched.
 */
export function RequestsScreen({
  actions,
  identity: signedIn = null,
}: {
  actions: KioskFlowActions;
  /** The visitor already signed in this session — the list opens without asking again. */
  identity?: IdentityVerification | null;
}) {
  const [identity, setIdentity] = useState<IdentityVerification | null>(signedIn);
  const requests = useRequests(identity?.documentNumber, undefined, identity !== null);
  const catalog = useCatalog();
  const discard = useDiscardRequest();
  const [search, setSearch] = useState("");

  const servicesById = useMemo(() => {
    const map = new Map<string, ServiceDefinition>();
    for (const category of catalog.data?.categories ?? []) {
      for (const group of category.groups) {
        for (const service of group.services) map.set(service.id, service);
      }
    }
    return map;
  }, [catalog.data]);

  const term = search.trim().toLowerCase();
  const rows = (requests.data?.requests ?? []).filter(
    (r) =>
      !term ||
      r.reference.toLowerCase().includes(term) ||
      r.serviceLabel.toLowerCase().includes(term) ||
      (r.holderName ?? "").toLowerCase().includes(term) ||
      (r.documentNumber ?? "").toLowerCase().includes(term),
  );

  const resume = (request: KioskRequest) => {
    const service = servicesById.get(request.serviceId);
    if (!service || request.stepIndex === null || !request.documentNumber) return;
    actions.resumeRequest(service, {
      documentNumber: request.documentNumber,
      stepIndex: request.stepIndex,
      data: request.data ?? {},
      documents: request.documents ?? {},
      identity: identity ?? undefined,
    });
  };

  if (!identity) {
    return (
      <div className="ks-aurora fixed inset-0 flex flex-col">
        <header className="flex-none border-b bg-card px-5 pt-5 pb-4 sm:px-8 lg:px-10">
          <KioskHeader />
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col items-center justify-center px-5 py-6 sm:px-8 lg:px-10">
            <IdentityGate onVerified={setIdentity} />
          </div>
        </main>
        <KioskFooter showBack onBack={actions.closeRequests} onStartOver={actions.reset} />
      </div>
    );
  }

  return (
    <div className="ks-aurora fixed inset-0 flex flex-col">
      <header className="flex-none border-b bg-card px-5 pt-5 pb-4 sm:px-8 lg:px-10">
        <KioskHeader />
      </header>
      <main className="flex-1 overflow-y-auto px-5 py-6 sm:px-8 lg:px-10">
        <div className="mx-auto w-full max-w-6xl animate-ks-fade">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">My Requests</h1>
              <p className="mt-2 text-xl text-muted-foreground">
                Your applications pending review, and saved ones you can resume.
              </p>
              <div className="mt-3 flex w-fit items-center gap-2 rounded-full bg-success/10 px-4 py-1.5 text-base font-semibold text-success">
                <ShieldCheck className="size-5" />
                {identity.profile.name} · {maskId(identity.documentNumber)}
              </div>
            </div>
            <div className="relative w-full max-w-sm">
              <Search className="absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by reference or service"
                className="h-14 rounded-2xl pl-12 text-lg"
              />
            </div>
          </div>

          {requests.isPending ? (
            <div className="flex justify-center py-24">
              <Spinner className="size-12 text-primary" />
            </div>
          ) : requests.isError ? (
            <LoadFailed
              message="Could not load the requests list"
              onRetry={() => requests.refetch()}
            />
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-24 text-center">
              <Inbox className="size-14 text-muted-foreground/50" />
              <p className="text-xl text-muted-foreground">
                {term ? "No requests match your search." : "You have no pending or saved requests."}
              </p>
            </div>
          ) : (
            <Card className="overflow-hidden rounded-3xl p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b bg-muted/40 text-sm font-bold tracking-[0.1em] text-muted-foreground/80 uppercase">
                      <th className="px-7 py-4">Reference</th>
                      <th className="px-4 py-4">Service</th>
                      <th className="px-4 py-4">Applicant</th>
                      <th className="px-4 py-4">Status</th>
                      <th className="px-4 py-4">Last Updated</th>
                      <th className="px-7 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((request) => (
                      <RequestRow
                        key={`${request.kind}-${request.reference}`}
                        request={request}
                        canResume={servicesById.has(request.serviceId)}
                        onResume={() => resume(request)}
                        onDiscard={() => discard.mutate(request.reference)}
                        discarding={
                          discard.isPending && discard.variables === request.reference
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {discard.isError && (
            <StepError>That request could not be discarded — please try again.</StepError>
          )}
        </div>
      </main>
      <KioskFooter showBack onBack={actions.closeRequests} onStartOver={actions.reset} />
    </div>
  );
}

function RequestRow({
  request,
  canResume,
  onResume,
  onDiscard,
  discarding,
}: {
  request: KioskRequest;
  canResume: boolean;
  onResume: () => void;
  onDiscard: () => void;
  discarding: boolean;
}) {
  return (
    <tr className="border-b align-top last:border-b-0">
      <td className="px-7 py-5 text-lg font-bold whitespace-nowrap text-primary">
        {request.reference}
      </td>
      <td className="px-4 py-5">
        <div className="text-lg font-semibold">{request.serviceLabel}</div>
        {request.kind === "saved" && request.stepId && (
          <div className="mt-1 text-base text-muted-foreground capitalize">
            Paused at: {request.stepId}
          </div>
        )}
        {request.statusReason && (
          <div className="mt-1.5 flex max-w-md items-start gap-2 text-base text-muted-foreground">
            <Info className="mt-1 size-4 shrink-0 text-warning" />
            {request.statusReason}
          </div>
        )}
      </td>
      <td className="px-4 py-5">
        <div className="text-lg font-semibold">{request.holderName ?? "—"}</div>
        <div className="text-base text-muted-foreground">
          {maskId(request.documentNumber)}
        </div>
      </td>
      <td className="px-4 py-5 whitespace-nowrap">
        <RequestStatusBadge status={request.status} />
      </td>
      <td className="px-4 py-5 text-lg whitespace-nowrap text-muted-foreground">
        {formatDateTime(request.updatedAt)}
      </td>
      <td className="px-7 py-5 whitespace-nowrap">
        {request.kind === "saved" ? (
          <div className="flex items-center justify-end gap-2.5">
            <Button
              onClick={onResume}
              disabled={!canResume}
              className="h-12 rounded-2xl px-6 text-base font-semibold [&_svg:not([class*='size-'])]:size-4.5"
            >
              <Play />
              Resume
            </Button>
            <Button
              variant="outline"
              onClick={onDiscard}
              disabled={discarding}
              aria-label={`Discard ${request.reference}`}
              className="size-12 rounded-2xl text-destructive [&_svg:not([class*='size-'])]:size-5"
            >
              {discarding ? <Spinner className="size-5" /> : <Trash2 />}
            </Button>
          </div>
        ) : (
          <div className="text-right text-base text-muted-foreground">Awaiting processing</div>
        )}
      </td>
    </tr>
  );
}
