// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { createElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { useIdleRestart } from "@/hooks/use-auto-restart";
import { useRequests, useSaveRequest, useServiceHealth } from "@/hooks/use-kiosk-api";
import { useKioskFlow } from "@/hooks/use-kiosk-flow";
import { resetA11y } from "@/lib/a11y";
import { findPendingDuplicate } from "@/lib/api/kiosk";
import { resolveStep } from "@/services/registry";
import { IdlePrompt } from "./idle-prompt";
import { KioskFooter } from "./kiosk-footer";
import { KioskHeader } from "./kiosk-header";
import { KioskStepper } from "./kiosk-stepper";
import { RequestsScreen } from "./requests-screen";
import { ServiceUnavailableScreen } from "./service-unavailable-screen";
import { SignInScreen } from "./sign-in-screen";
import { WelcomeScreen } from "./welcome-screen";

export function KioskApp() {
  const { state, steps, currentStep, actions } = useKioskFlow();
  const health = useServiceHealth();
  const main = useRef<HTMLElement>(null);
  // A layout effect, so a step that scrolls itself on arrival (a ward list) still has the last word.
  useLayoutEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [currentStep, state.categoryId, state.service?.id, state.view, state.started]);
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
    (existing.isPending ||
      Boolean(findPendingDuplicate(existing.data?.requests ?? [], state.service ?? {})));

  // The registry returns stable, module-level component references, so
  // rendering via createElement keeps identity across renders.
  const step = resolveStep(state.service, currentStep);

  // The closing screens run their own logout countdown.
  const closing = currentStep === "receipt" || currentStep === "result";
  const routeScreen = state.service?.id === "directions" && currentStep === "result";
  const [idlePrompt, setIdlePrompt] = useState(false);
  const restart = () => {
    setIdlePrompt(false);
    actions.reset();
  };
  // A payment or save in flight is the kiosk working, not the citizen gone; so
  // is the card reader or camera waiting on them, and nothing personal is on
  // screen until identity is verified.
  const working = useIsMutating() > 0;
  const atMachine = (currentStep === "identity" && !state.identity) || state.view === "signin";
  useIdleRestart({
    enabled: state.started && !closing && !idlePrompt && !health.unavailable,
    paused: working || atMachine,
    onIdle: () => setIdlePrompt(true),
  });
  // Every way a session ends lands on the welcome screen; settings go with the visitor.
  const wasStarted = useRef(state.started);
  useEffect(() => {
    if (wasStarted.current && !state.started) resetA11y();
    wasStarted.current = state.started;
  }, [state.started]);

  const idle = <IdlePrompt open={idlePrompt} onStay={() => setIdlePrompt(false)} onRestart={restart} />;

  // Blocks the whole kiosk — welcome screen included — until the AI services
  // come back. Session state is kept, so a mid-flow visitor resumes in place.
  if (health.unavailable) {
    return <ServiceUnavailableScreen />;
  }

  if (!state.started) {
    return (
      <WelcomeScreen
        onBegin={actions.begin}
        onSignIn={() => {
          actions.begin();
          actions.openSignIn();
        }}
      />
    );
  }

  if (state.view === "requests") {
    return (
      <>
        <RequestsScreen actions={actions} identity={state.identity} />
        {idle}
      </>
    );
  }

  const header = <KioskHeader patient={state.profile?.name} onSignOut={state.identity ? restart : undefined} />;

  if (state.view === "signin") {
    return (
      <div className="ks-aurora fixed inset-0 flex flex-col">
        <header className="ks-veil-header flex-none border-b px-5 pt-5 pb-4 sm:px-8 lg:px-10">{header}</header>
        <main ref={main} className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col items-center justify-center px-5 py-6 sm:px-8 lg:px-10">
            <SignInScreen actions={actions} />
          </div>
        </main>
        <KioskFooter showBack onBack={actions.back} onStartOver={restart} />
        {idle}
      </div>
    );
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
      <header className="ks-veil-header flex-none border-b px-5 pt-5 pb-4 sm:px-8 lg:px-10">
        {header}
        {!routeScreen && <KioskStepper steps={steps} currentIndex={state.stepIndex} service={state.service} />}
      </header>
      <main ref={main} className="min-h-0 flex-1 overflow-y-auto">
        <div className={`flex min-h-full flex-col items-center px-5 py-6 sm:px-8 lg:px-10 ${routeScreen ? "h-full" : "justify-center"}`}>
          {step && createElement(step, { service: state.service, state, actions })}
        </div>
      </main>
      <KioskFooter
        showBack={(state.stepIndex > 0 || Boolean(state.categoryId)) && !closing}
        onBack={
          state.stepIndex === 0 && state.categoryId ? actions.clearCategory : actions.back
        }
        onStartOver={closing ? undefined : restart}
        confirmStartOver={Boolean(state.service)}
        onSaveExit={canSave ? saveAndExit : undefined}
        saving={saveRequest.isPending}
      />
      {idle}
    </div>
  );
}
