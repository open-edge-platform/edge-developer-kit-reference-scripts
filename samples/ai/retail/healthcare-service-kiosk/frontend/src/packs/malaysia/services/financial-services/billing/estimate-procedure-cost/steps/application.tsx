// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { Stethoscope } from "lucide-react";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { formatMoney, kioskCurrency } from "@/lib/format";
import { OptionCards, SectionLabel } from "@/services/shared/fields";
import { resultData } from "@/services/shared/result";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";
import { PAYERS, PROCEDURES } from "@/hospital/data";
import { estimateResult } from "../estimate";

export default function ProcedureStep({ state, actions }: StepProps) {
  const [procedureId, setProcedureId] = useState(state.data.procedureId ?? "");
  const [payerId, setPayerId] = useState(state.data.payer ?? "");
  const currency = kioskCurrency();
  const procedure = PROCEDURES.find((p) => p.id === procedureId);

  return (
    <StepShell
      title="Estimate a procedure cost"
      subtitle="Choose a procedure, then how you'll be paying."
      className="max-w-5xl"
    >
      <StepCard>
        <OptionCards
          options={PROCEDURES.map((p) => ({ id: p.id, label: p.name, icon: Stethoscope }))}
          value={procedureId}
          onSelect={(id) => {
            setProcedureId(id);
            setPayerId("");
          }}
          columns={3}
        />
        {procedure && (
          <>
            <SectionLabel>How will you be paying?</SectionLabel>
            <OptionCards
              options={[{ id: "self", label: "Self-pay" }, ...PAYERS.map((p) => ({ id: p.id, label: p.name }))]}
              value={payerId}
              onSelect={setPayerId}
              columns={3}
            />
          </>
        )}
        <StepActions
          ready={Boolean(procedure && payerId)}
          idleLabel={procedure ? "Select how you'll be paying" : "Select a procedure"}
          label="Show estimate"
          onContinue={() =>
            actions.stepCompleted("application", {
              procedureId,
              payer: payerId,
              ...resultData(estimateResult(procedure!, payerId, (amount) => formatMoney(amount, currency))),
            })
          }
        />
      </StepCard>
    </StepShell>
  );
}
