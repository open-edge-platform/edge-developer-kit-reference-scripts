// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import {
  ArrowRight,
  CarFront,
  CircleCheck,
  CreditCard,
  FileText,
  Search,
  type LucideIcon,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { CtaButton } from "@/components/kiosk/cta-button";
import { Notice } from "@/components/kiosk/notice";
import { StepError } from "@/components/kiosk/status-block";
import { StepFooter } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { useFineLookup } from "@/hooks/use-kiosk-api";
import type { FineLookupResult } from "@/lib/api/kiosk";
import { countOf, formatMoney, formatShortDate } from "@/lib/format";
import { ListHeading, OptionCards, TextField } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";

const LOOKUP_KEYS: { id: string; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "summons", label: "Summons No.", hint: "On the saman notice", icon: FileText },
  { id: "plate", label: "Plate Number", hint: "Vehicle registration", icon: CarFront },
  { id: "mykad", label: "MyKad Number", hint: "All summonses in your name", icon: CreditCard },
];

export default function SamanLookupStep({ state, actions }: StepProps) {
  const verifiedIc = state.identity?.documentNumber ?? "";
  const [lookupBy, setLookupBy] = useState(state.data.lookupBy ?? (verifiedIc ? "mykad" : "summons"));
  const [reference, setReference] = useState(state.data.reference ?? verifiedIc);
  const [searched, setSearched] = useState(Boolean(state.data.reference ?? verifiedIc));
  const valid = reference.trim().length > 0;

  const lookup = useFineLookup(lookupBy, reference.trim(), searched && valid);
  const result = searched ? lookup.data : undefined;
  const found = Boolean(result && result.fines.length > 0);

  const selectLookupKey = (id: string) => {
    setLookupBy(id);
    if (id === "mykad" && verifiedIc) {
      setReference(verifiedIc);
      setSearched(true);
    } else {
      if (reference === verifiedIc) setReference("");
      setSearched(false);
    }
  };

  return (
    <StepShell
      title="Look up your saman"
      subtitle={
        verifiedIc
          ? "Summonses in your name are pulled from the registry automatically — or search another reference."
          : "Covers both JPJ and PDRM summonses. Choose how to search."
      }
      className="max-w-3xl"
    >
      <StepCard>
        <OptionCards options={LOOKUP_KEYS} value={lookupBy} onSelect={selectLookupKey} />
        <div className="mt-6">
          <TextField
            id="reference"
            label={LOOKUP_KEYS.find((k) => k.id === lookupBy)?.label ?? "Reference"}
            value={reference}
            onChange={(value) => {
              setReference(value);
              setSearched(false);
            }}
            placeholder="e.g. WJ10000137 or WXY 1234"
          />
        </div>

        {result &&
          (found ? (
            <SamanResults result={result} />
          ) : (
            <Notice tone="success" icon={CircleCheck} className="mt-6 p-5 text-lg font-medium">
              No outstanding summonses found for this reference. Nothing to pay!
            </Notice>
          ))}
        {searched && lookup.isError && (
          <StepError>The summons registry could not be reached — please try again.</StepError>
        )}

        <Notice className="mt-5">
          From 1 Jan 2026: 50% discount if paid within 15 days, 33% within 16–30 days, full
          amount from day 31. Unpaid summonses past 60 days lead to blacklisting, which blocks
          license and road tax renewal.
        </Notice>
        <StepFooter>
          {result && found ? (
            <CtaButton
              onClick={() =>
                actions.stepCompleted("application", { lookupBy, reference: reference.trim() })
              }
            >
              Pay {formatMoney(result.total, result.currency)}
              <ArrowRight />
            </CtaButton>
          ) : (
            <CtaButton
              disabled={!valid || (searched && lookup.isLoading)}
              onClick={() => setSearched(true)}
            >
              {searched && lookup.isLoading ? (
                "Searching the registry…"
              ) : valid ? (
                <>
                  Look Up Summonses
                  <Search />
                </>
              ) : (
                "Enter a reference to continue"
              )}
            </CtaButton>
          )}
        </StepFooter>
      </StepCard>
    </StepShell>
  );
}

function SamanResults({ result }: { result: FineLookupResult }) {
  return (
    <div className="mt-6 rounded-2xl border bg-background p-5">
      <ListHeading>
        {countOf(result.fines.length, "outstanding summons", "outstanding summonses")}
      </ListHeading>
      {result.fines.map((fine) => (
        <div key={fine.summonsNo}>
          <div className="flex items-center justify-between gap-4 py-3">
            <div>
              <div className="text-lg font-semibold">{fine.offence}</div>
              <div className="text-base text-muted-foreground">
                {fine.summonsNo} · {fine.plateNumber} · {formatShortDate(fine.issuedAt)}
              </div>
            </div>
            <div className="text-xl font-bold">{formatMoney(fine.amount, result.currency)}</div>
          </div>
          <Separator />
        </div>
      ))}
      <div className="flex items-center justify-between pt-4">
        <span className="text-lg font-bold">Total outstanding</span>
        <span className="text-2xl font-bold text-primary">
          {formatMoney(result.total, result.currency)}
        </span>
      </div>
    </div>
  );
}
