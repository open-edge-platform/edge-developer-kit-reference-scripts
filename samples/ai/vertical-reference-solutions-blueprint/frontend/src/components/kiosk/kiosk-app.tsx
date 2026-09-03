// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { createElement } from "react";
import { useRequests, useSaveRequest, useServiceHealth } from "@/hooks/use-kiosk-api";
import { useKioskFlow } from "@/hooks/use-kiosk-flow";
import { findPendingDuplicate } from "@/lib/api/kiosk";
import { resolveStep } from "@/services/registry";
import { KioskFooter } from "./kiosk-footer";
import { KioskHeader } from "./kiosk-header";
import { KioskStepper } from "./kiosk-stepper";
import { RequestsScreen } from "./requests-screen";
import { ServiceUnavailableScreen } from "./service-unavailable-screen";
import { WelcomeScreen } from "./welcome-screen";

export function KioskApp() {
  const { state, steps, currentStep, actions } = useKioskFlow();
  const health = useServiceHealth();
  const saveRequest = useSaveRequest();

  // Mirrors the payment step's duplicate wall (same query key, so the fetch
  // and cache are shared): while that wall is up, Save & Exit would only add
  // a draft that dead-ends at the same wall, showing up in My Requests as a
  // confusing second entry next to the pending case.
  const dupGuardActive = Boolean(
    state.service && state.identity && !state.service.repeatable && currentStep === "payment",
  );
  const existing = useRequests(state.identity?.documentNumber, state.service?.id, dupGuardActive);
  const blockedByPending =
    dupGuardActive &&
    (existing.isPending || Boolean(findPendingDuplicate(existing.data?.requests ?? [])));

  // The registry returns stable, module-level component references, so
  // rendering via createElement keeps identity across renders.
  const step = resolveStep(state.service, currentStep);

  // Blocks the whole kiosk — welcome screen included — until the AI services
  // come back. Session state is kept, so a mid-flow visitor resumes in place.
  if (health.unavailable) {
    return <ServiceUnavailableScreen />;
  }

  if (!state.started) {
    return <WelcomeScreen onBegin={actions.begin} />;
  }

  if (state.view === "requests") {
    return <RequestsScreen actions={actions} />;
  }

  // A verified visitor mid-flow can pause: the draft is saved server-side
  // (one per citizen + service) and listed under Requests for later resume.
  const canSave = Boolean(
    state.service &&
      state.identity &&
      !state.application &&
      currentStep !== "receipt" &&
      !blockedByPending,
  );
  const saveAndExit = () => {
    saveRequest.mutate(
      {
        serviceId: state.service!.id,
        documentNumber: state.identity!.documentNumber,
        stepId: currentStep,
        stepIndex: state.stepIndex,
        data: state.data,
        documents: state.documents,
      },
      { onSuccess: () => actions.reset() },
    );
  };

  return (
    <div className="ks-aurora fixed inset-0 flex flex-col">
      <header className="ks-veil-header flex-none border-b px-10 pt-6 pb-5 backdrop-blur-xl">
        <KioskHeader />
        <KioskStepper steps={steps} currentIndex={state.stepIndex} service={state.service} />
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col items-center justify-center p-10">
          {step && createElement(step, { service: state.service, state, actions })}
        </div>
      </main>
      <KioskFooter
        showBack={(state.stepIndex > 0 || Boolean(state.categoryId)) && currentStep !== "receipt"}
        onBack={
          state.stepIndex === 0 && state.categoryId ? actions.clearCategory : actions.back
        }
        onSaveExit={canSave ? saveAndExit : undefined}
        saving={saveRequest.isPending}
      />
    </div>
  );
}
