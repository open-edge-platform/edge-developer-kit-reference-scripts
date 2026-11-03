// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Check,
  CameraOff,
  HeartHandshake,
  IdCard,
  RotateCcw,
  ScanFace,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  UserCheck,
} from "lucide-react";
import { CtaButton } from "@/components/kiosk/cta-button";
import { CardReaderVisual, ContactlessVisual, type DeviceState } from "@/components/kiosk/device-visual";
import { FaceViewport, WaitingDots, facePhaseCopy, useFaceScanSequence } from "@/components/kiosk/face-scan";
import { SecondaryButton } from "@/components/kiosk/secondary-button";
import { StatusBlock } from "@/components/kiosk/status-block";
import { StepCard } from "@/components/kiosk/step-card";
import { Spinner } from "@/components/ui/spinner";
import { useServiceHealth } from "@/hooks/use-kiosk-api";
import { ApiError } from "@/lib/api/client";
import {
  discardEnrollment,
  enrollPatient,
  readEnrollmentCard,
  watchEnrollmentCard,
  type CardEnrollment,
  type Enrolled,
} from "@/lib/api/self-enrollment";
import { idGesture, idReaderCopy, readerFaultHelp } from "@/lib/id-reader";
import { ListHeading, OptionCards } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";
import { SEE_THE_COUNTER } from "../registered";

/** How long the welcome stays up before the flow moves on (ms). */
const WELCOME_HOLD_MS = 1_600;

type Stage =
  | { at: "card" }
  | { at: "confirm"; read: CardEnrollment }
  | { at: "photo"; read: CardEnrollment }
  | { at: "welcome"; enrolled: Enrolled }
  | { at: "counter" }
  | { at: "registered"; message: string };

/**
 * Registering a new patient, where other services identify one: tap the
 * MyKad, confirm what its chip says, have the record photo taken. The record
 * that creates is the verified patient for the rest of the flow. Keep the
 * words in step with the chat's enrolment (src/app/api/_lib/flows/engine.ts).
 */
export default function EnrollStep({ state, actions }: StepProps) {
  const [stage, setStage] = useState<Stage>({ at: "card" });

  const enrolled = stage.at === "welcome" ? stage.enrolled : null;
  useEffect(() => {
    if (!enrolled) return;
    const timer = setTimeout(
      () => actions.identityVerified(enrolled, { detailsConfirmed: "yes", ...(enrolled.portrait ? {} : { portraitTaken: "no" }) }),
      WELCOME_HOLD_MS,
    );
    return () => clearTimeout(timer);
  }, [enrolled, actions]);

  // Back from the next step, or a visitor who signed in first: there is a record already.
  if (state.identity && !enrolled) {
    const justMade = state.data.detailsConfirmed === "yes";
    return (
      <Outcome
        icon={UserCheck}
        title={justMade ? "Your record is created" : "You're already registered"}
        description={
          justMade
            ? "Carry on to add your contact details."
            : `You're signed in as ${state.profile?.name ?? "a registered patient"}. To check or update your details, use Patient Verification.`
        }
        action={justMade ? <CtaButton onClick={actions.next}>Continue</CtaButton> : null}
      />
    );
  }

  switch (stage.at) {
    case "card":
      return (
        <CardStage
          onRead={(read) => setStage({ at: "confirm", read })}
          onRegistered={(message) => setStage({ at: "registered", message })}
        />
      );
    case "confirm":
      return (
        <ConfirmStage
          read={stage.read}
          onYes={() => setStage({ at: "photo", read: stage.read })}
          onNo={() => {
            discardEnrollment(stage.read.token).catch(() => {});
            setStage({ at: "counter" });
          }}
        />
      );
    case "photo":
      return (
        <PhotoStage
          read={stage.read}
          onEnrolled={(made) => setStage({ at: "welcome", enrolled: made })}
          onStartAgain={() => setStage({ at: "card" })}
        />
      );
    case "welcome":
      return <Welcome enrolled={stage.enrolled} />;
    case "counter":
      return (
        <Outcome
          icon={HeartHandshake}
          title="Please see the registration counter"
          description={SEE_THE_COUNTER}
          action={<CtaButton onClick={actions.reset}>Done</CtaButton>}
        />
      );
    case "registered":
      return (
        <Outcome
          icon={UserCheck}
          title="You're already registered"
          description={stage.message}
          action={<CtaButton onClick={actions.reset}>Back to the start</CtaButton>}
        />
      );
  }
}

function Outcome({
  icon,
  title,
  description,
  action,
}: {
  icon: typeof UserCheck;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <StepShell title="Create Patient Record" className="max-w-3xl">
      <StepCard>
        <StatusBlock icon={icon} iconClassName="text-primary" title={title} description={description} action={action} />
      </StepCard>
    </StepShell>
  );
}

/** Waits on the card reader; on a kiosk whose reader is simulated, a demo button stands in for it. */
function CardStage({
  onRead,
  onRegistered,
}: {
  onRead: (read: CardEnrollment) => void;
  onRegistered: (message: string) => void;
}) {
  const reader = useServiceHealth().services?.nfc;
  const [failure, setFailure] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [lost, setLost] = useState(false);
  const [arm, setArm] = useState(0);
  const handlers = useRef({ onRead, onRegistered });
  useEffect(() => {
    handlers.current = { onRead, onRegistered };
  });

  useEffect(() => {
    const control = new AbortController();
    let live = true;
    void (async () => {
      while (live) {
        try {
          const read = await watchEnrollmentCard(control.signal);
          if (read && live) handlers.current.onRead(read);
          if (read) return;
        } catch (error) {
          if (!live) return;
          if (error instanceof ApiError && error.reason === "registered") {
            handlers.current.onRegistered(error.message);
            return;
          }
          // 404: a card was there but could not be read — keep listening for the next try.
          if (error instanceof ApiError && error.status === 404) {
            setFailure(idReaderCopy().reseat);
            continue;
          }
          setLost(true);
          return;
        }
      }
    })();
    return () => {
      live = false;
      control.abort();
    };
  }, [arm]);

  const demo = () => {
    setFailure(null);
    setReading(true);
    readEnrollmentCard()
      .then((read) => handlers.current.onRead(read))
      .catch((error) => {
        setReading(false);
        if (error instanceof ApiError && error.reason === "registered") handlers.current.onRegistered(error.message);
        else setFailure(error instanceof Error ? error.message : "The MyKad couldn't be read.");
      });
  };

  const copy = idReaderCopy();
  const Visual = idGesture() === "tap" ? ContactlessVisual : CardReaderVisual;
  const simulated = reader === "off";
  const broken = lost && !simulated;
  const device: DeviceState = reading ? "done" : broken ? "error" : "waiting";

  return (
    <StepShell
      title={copy.title}
      subtitle="Your name, IC number and address are read from its chip — there's nothing to type."
      className="max-w-3xl"
    >
      <StepCard className="flex flex-col items-center gap-7 py-10 text-center">
        <div className="[zoom:1.3]">
          <Visual state={device} />
        </div>
        <p className="max-w-xl text-lg text-pretty text-muted-foreground">{copy.detail}</p>
        {failure && (
          <div role="alert" className="flex max-w-xl items-start gap-3 rounded-2xl border-2 border-destructive/30 bg-destructive/5 px-5 py-3 text-left text-base">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
            {failure}
          </div>
        )}
        {reading ? (
          <div className="flex items-center gap-3 text-lg font-semibold" aria-live="polite">
            <Spinner className="size-6 text-primary" />
            Reading your MyKad…
          </div>
        ) : broken ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-lg font-semibold">The card reader isn&apos;t available. {readerFaultHelp()}</p>
            <CtaButton
              onClick={() => {
                setLost(false);
                setFailure(null);
                setArm((n) => n + 1);
              }}
            >
              <RotateCcw />
              Try again
            </CtaButton>
          </div>
        ) : simulated ? (
          <SecondaryButton className="border-dashed" onClick={demo}>
            <IdCard className="size-5" />
            Demo MyKad
          </SecondaryButton>
        ) : (
          <div className="flex items-center gap-3 text-lg text-muted-foreground" aria-live="polite">
            <WaitingDots className="text-primary" />
            Waiting for your MyKad…
          </div>
        )}
      </StepCard>
      <p className="mt-7 flex items-center justify-center gap-2.5 text-base text-muted-foreground">
        <HeartHandshake className="size-5 text-primary" />
        No MyKad with you? The registration counter can register you with your passport.
      </p>
    </StepShell>
  );
}

function ConfirmStage({ read, onYes, onNo }: { read: CardEnrollment; onYes: () => void; onNo: () => void }) {
  const [answer, setAnswer] = useState("");
  return (
    <StepShell
      title="Are these your details?"
      subtitle={read.simulated ? "Read from your MyKad." : idReaderCopy().remove}
      className="max-w-3xl"
    >
      <StepCard>
        <ListHeading className="flex items-center gap-2">
          <IdCard className="size-5" /> From your MyKad
        </ListHeading>
        <dl className="mb-6">
          {read.lines.map((line) => (
            <div key={line.label} className="flex items-baseline justify-between gap-6 border-b py-4 last:border-b-0">
              <dt className="text-base text-muted-foreground">{line.label}</dt>
              <dd className="text-right text-xl font-semibold break-words">{line.value}</dd>
            </div>
          ))}
        </dl>
        <OptionCards
          options={[
            { id: "yes", label: "Yes, that's me", icon: ThumbsUp },
            { id: "no", label: "No, something is wrong", icon: ThumbsDown },
          ]}
          value={answer}
          onSelect={(id) => {
            setAnswer(id);
            if (id === "yes") onYes();
            else onNo();
          }}
          columns={2}
        />
      </StepCard>
    </StepShell>
  );
}

/** The record photo: the face check's framing beats, then the picture is saved rather than matched. */
function PhotoStage({
  read,
  onEnrolled,
  onStartAgain,
}: {
  read: CardEnrollment;
  onEnrolled: (enrolled: Enrolled) => void;
  onStartAgain: () => void;
}) {
  const [cameraless, setCameraless] = useState(false);
  const enroll = useMutation({
    mutationFn: (image: string | null) => enrollPatient(read.token, image),
    onSuccess: onEnrolled,
  });
  const scan = useFaceScanSequence({
    enabled: !cameraless,
    outcome: enroll.isError ? "failed" : "pending",
    onCapture: (frame) => enroll.mutate(frame),
  });
  const blocked = scan.blocked && !cameraless;
  const error = enroll.error;
  // A photo the detector couldn't use is simply taken again; anything else means reading the card again.
  const retake = error instanceof ApiError && (error.reason === "no_face" || error.reason === "several_faces");
  const copy = scan.phase === "scanning" ? { caption: "Saving your photo…", hint: "Keep still a moment." } : facePhaseCopy(scan.phase);

  return (
    <StepShell
      title="Now your photo"
      subtitle="It goes on your record, so the kiosk can recognise you next time you tap your MyKad."
      className="max-w-5xl"
    >
      <div className="mx-auto flex flex-col items-center gap-10 lg:flex-row lg:justify-center lg:gap-16">
        {blocked || cameraless ? (
          <div className="flex aspect-3/4 w-72 shrink-0 flex-col items-center justify-center gap-4 rounded-[36px] border-2 bg-muted text-muted-foreground lg:w-[22rem]">
            {enroll.isPending ? <Spinner className="size-10" /> : <CameraOff className="size-14" strokeWidth={1.4} />}
          </div>
        ) : (
          <FaceViewport phase={scan.phase} videoRef={scan.videoRef} live={scan.live} className="shrink-0 lg:w-[22rem]" />
        )}
        <div className="flex w-full max-w-md flex-col gap-5 text-left">
          {error ? (
            <>
              <div className="text-3xl font-bold tracking-tight">
                {retake ? "Let's take that again" : "We couldn't save your record"}
              </div>
              <p className="text-lg text-pretty text-muted-foreground">{error.message}</p>
              <div className="flex flex-wrap gap-3">
                {retake ? (
                  <CtaButton
                    onClick={() => {
                      enroll.reset();
                      scan.restart();
                    }}
                  >
                    <RotateCcw />
                    Take my photo again
                  </CtaButton>
                ) : (
                  <CtaButton onClick={onStartAgain}>
                    <RotateCcw />
                    Start again
                  </CtaButton>
                )}
              </div>
            </>
          ) : blocked ? (
            <>
              <div className="text-3xl font-bold tracking-tight">
                {scan.cameraStatus === "denied" ? "The camera is blocked" : "The camera isn't working"}
              </div>
              <p className="text-lg text-pretty text-muted-foreground">
                You can register without a photo — the registration counter will take it before printing your card.
              </p>
              <div className="flex flex-wrap gap-3">
                <CtaButton onClick={scan.retryCamera}>
                  <RotateCcw />
                  Try the camera again
                </CtaButton>
                <SecondaryButton
                  onClick={() => {
                    setCameraless(true);
                    enroll.mutate(null);
                  }}
                >
                  Continue without a photo
                </SecondaryButton>
              </div>
            </>
          ) : cameraless ? (
            <div className="text-2xl font-bold tracking-tight">Creating your record…</div>
          ) : (
            <>
              <div className="text-3xl font-bold tracking-tight">{copy.caption}</div>
              <p className="text-lg text-pretty text-muted-foreground">{copy.hint}</p>
              {scan.canSkip && (
                <SecondaryButton className="self-start" onClick={scan.scanNow}>
                  <ScanFace className="size-5" />
                  I&apos;m ready — take it now
                </SecondaryButton>
              )}
            </>
          )}
        </div>
      </div>
    </StepShell>
  );
}

function Welcome({ enrolled }: { enrolled: Enrolled }) {
  return (
    <StepShell
      title={`Welcome, ${enrolled.profile.name.split(" ")[0]}`}
      subtitle={enrolled.portrait ? "Your patient record is created." : "Your patient record is created — the counter will take your photo."}
    >
      <div className="flex flex-col items-center gap-8">
        <div className="flex size-36 animate-ks-pop items-center justify-center rounded-full bg-[image:var(--gradient-success)] shadow-[0_18px_50px_-8px_rgba(33,128,92,0.55)]">
          <Check className="size-16 animate-ks-draw text-white [stroke-dasharray:30] [stroke-dashoffset:30]" strokeWidth={2.6} />
        </div>
        <div className="flex flex-col items-center gap-3">
          <p className="text-xl text-muted-foreground">Taking you to the next step…</p>
          <div className="h-2 w-72 overflow-hidden rounded-full bg-muted">
            <div className="ks-gradient h-full origin-left animate-ks-fill" style={{ animationDuration: `${WELCOME_HOLD_MS}ms` }} />
          </div>
        </div>
      </div>
    </StepShell>
  );
}
