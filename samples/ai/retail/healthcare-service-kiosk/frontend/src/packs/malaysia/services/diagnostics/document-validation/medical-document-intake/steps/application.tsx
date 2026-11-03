// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, CalendarDays, Check, FileText, PencilLine } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { CtaButton } from "@/components/kiosk/cta-button";
import { IconTile } from "@/components/kiosk/icon-tile";
import { SecondaryButton } from "@/components/kiosk/secondary-button";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { readDocument } from "@/lib/api/document-ai";
import { displayDay } from "@/lib/document-fields";
import { OptionCards } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";
import {
  DOC_TYPES,
  MANUAL_CLASSIFICATION,
  docType,
  intakeData,
  isDocType,
  typeQuestion,
  type Classification,
  type DocTypeId,
} from "../doctypes";

export default function DocumentTypeStep({ service, state, actions }: StepProps) {
  const serviceId = service?.id ?? "";
  const upload = state.documents.medical;
  const documentNumber = state.identity?.documentNumber ?? "";
  const [changing, setChanging] = useState(false);
  const [picked, setPicked] = useState<DocTypeId | null>(null);

  const read = useQuery({
    queryKey: ["document-ai", serviceId, "medical", upload?.uploadedAt],
    queryFn: () =>
      readDocument<Classification>({
        serviceId,
        documentId: "medical",
        documentNumber,
        uploadedAt: upload?.uploadedAt ?? "",
      }),
    enabled: Boolean(serviceId && upload && documentNumber),
    retry: false,
    staleTime: Infinity,
  });

  if (read.isFetching && !read.data) {
    return (
      <StepShell title="What are you adding today?" subtitle="Recognising your document…" className="max-w-3xl">
        <StepCard className="flex flex-col items-center gap-5 py-16 text-center">
          <Spinner className="size-12 text-primary" />
          <div className="text-xl font-semibold">Reading your document</div>
        </StepCard>
      </StepShell>
    );
  }

  const guess = read.data ?? MANUAL_CLASSIFICATION;
  const known = guess.type !== "other" ? docType(guess.type) : undefined;
  const finish = (chosen: DocTypeId) =>
    actions.stepCompleted("application", intakeData(guess, chosen, upload?.uploadedAt ?? ""));

  if (known && !changing) {
    return (
      <StepShell
        title={typeQuestion(guess.type)}
        subtitle="Confirm what you're adding so it's filed in the right place in your record."
        className="max-w-3xl"
      >
        <StepCard className="flex flex-col items-center text-center">
          <IconTile icon={FileText} />
          <div className="mt-5 text-3xl font-bold">{known.label}</div>
          {(guess.issuer || guess.docDate) && (
            <div className="mt-4 flex flex-col items-center gap-2 text-lg text-muted-foreground">
              {guess.issuer && (
                <span className="inline-flex items-center gap-2">
                  <Building2 className="size-5 shrink-0" /> {guess.issuer}
                </span>
              )}
              {guess.docDate && (
                <span className="inline-flex items-center gap-2">
                  <CalendarDays className="size-5 shrink-0" /> Dated {displayDay(guess.docDate)}
                </span>
              )}
            </div>
          )}
          <div className="mt-9 grid w-full gap-4 sm:grid-cols-2">
            <SecondaryButton className="h-auto min-h-16 text-xl" onClick={() => setChanging(true)}>
              <PencilLine /> No, change it
            </SecondaryButton>
            <CtaButton onClick={() => finish(guess.type)}>
              <Check /> Yes, that&apos;s right
            </CtaButton>
          </div>
        </StepCard>
      </StepShell>
    );
  }

  return (
    <StepShell
      title={typeQuestion(null)}
      subtitle="Choose the kind of document you're adding to your medical record."
      className="max-w-4xl"
    >
      <StepCard>
        <OptionCards
          options={DOC_TYPES.map((t) => ({ id: t.id, label: t.label, icon: FileText }))}
          value={picked}
          onSelect={(id) => isDocType(id) && setPicked(id)}
          columns={3}
        />
        <StepActions
          ready={Boolean(picked)}
          idleLabel="Select a document type to continue"
          onContinue={() => picked && finish(picked)}
        />
      </StepCard>
    </StepShell>
  );
}
