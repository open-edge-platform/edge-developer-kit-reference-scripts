// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { t } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  CameraOff,
  Check,
  CircleAlert,
  CircleHelp,
  Clock,
  IdCard,
  MousePointerClick,
  Paperclip,
  RotateCcw,
  ScanFace,
  SendHorizontal,
  Volume2,
  Wallet,
} from "lucide-react";
import { DEVICE_STEP_REPLY, REQUESTS_FLOW_ID } from "@/app/api/_lib/flows/types";
import type { Ask, FlowResponse, FlowUpload } from "@/app/api/_lib/flows/types";
import type { KioskUIMessage } from "@/app/api/chat/route";
import { ActionHint } from "@/components/kiosk/action-hint";
import {
  CardReaderVisual,
  ContactlessVisual,
  ScannerVisual,
  type DeviceState,
} from "@/components/kiosk/device-visual";
import {
  FaceViewport,
  captureFrame,
  WaitingDots,
  facePhaseCopy,
  useFaceScanSequence,
} from "@/components/kiosk/face-scan";
import { KioskBrand } from "@/components/kiosk/kiosk-brand";
import { ServiceUnavailableScreen } from "@/components/kiosk/service-unavailable-screen";
import { ModeToggle } from "@/components/kiosk/mode-toggle";
import { ThemeToggle } from "@/components/kiosk/theme-toggle";
import { WelcomeScreen } from "@/components/kiosk/welcome-screen";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAutoRestart, useIdleRestart } from "@/hooks/use-auto-restart";
import { useServiceHealth } from "@/hooks/use-kiosk-api";
import { SERVICES } from "@/services";
import { ApiError } from "@/lib/api/client";
import { readCard } from "@/lib/api/enrollment";
import { DOCUMENT_SOURCE, getMockDocument, waitForScannedDocument } from "@/lib/api/kiosk";
import { matchOptionAnswers } from "@/lib/ask-match";
import { ID_GESTURE, idReaderCopy } from "@/lib/id-reader";
import { cn } from "@/lib/utils";
import { activePack } from "@/packs";
import { AvatarPanel } from "./avatar-panel";
import { messageText, speakableText, useKioskChat } from "./use-chat";
import { narrationLanguage, useChatVoice, type ChatVoice } from "./use-chat-voice";
import { MicButton, micStatusText, SpeakButton } from "./voice-controls";

/** Hold the kiosk's own next move until it has finished speaking; the citizen's answer interrupts. */
const WAIT_FOR_SPEECH = process.env.NEXT_PUBLIC_KIOSK_WAIT_FOR_SPEECH !== "false";

const BIOMETRIC_ASK_ID = "biometric";

/** Recapturing hands over the same bytes forever, so fall back to the file picker after this. */
const MAX_AUTO_CAPTURES = 3;

const RECAPTURE_MS = 3_000;

const REFUSAL_HOLD_SECONDS = 3;

type CaptureStatus = {
  askId: string;
  message: string;
  triesLeft?: number;
};

type Refusal = { askId: string; secondsLeft: number };

const ID_READER = idReaderCopy();

/** Language every session starts in; spoken turns may switch it — see use-chat-voice. */
const DEFAULT_LANGUAGE = process.env.NEXT_PUBLIC_KIOSK_LANG ?? activePack().locale.language;

const WELCOME_COPY =
  "Welcome! I'm the kiosk assistant. Tell me what you need — for example " +
  "“renew my road tax” or “pay a saman” — or tap a service below. " +
  "I'll guide you through each step at the kiosk.";

const DEVICE_STEPS: Record<
  string,
  { detected: string; receipt: string; confirm: string; help: string }
> = {
  insertDocument: {
    detected: "Card detected — reading it now…",
    receipt: t("deviceStep.insertDocument.receipt"),
    confirm: ID_READER.confirm,
    help: t("deviceStep.insertDocument.help", { where: ID_READER.where }),
  },
  biometric: {
    detected: "Face matched — continuing…",
    receipt: "Face check passed",
    confirm: "I'm looking at the camera",
    help:
      "The camera sits above the screen. If it cannot see you, a staff member at the " +
      "counter can verify you in person.",
  },
  payment: {
    detected: "Payment detected — completing…",
    receipt: "Payment taken at the terminal",
    confirm: "I've paid — continue",
    help:
      "Payment is taken at the terminal beside the screen. If your card will not read, " +
      "start the step again and choose QR or cash, or pay at the counter.",
  },
};

/** Hold the finished frame briefly so the citizen sees the step succeed before it disappears. */
const DONE_HOLD_MS = 700;

/** Fallback copy when no reader answered — deliberately doesn't claim a card was detected. */
const NO_READER_COPY = {
  waiting: "This kiosk's card reader isn't answering — continuing without it…",
  detected: "Continuing without a card read…",
};

export function ChatKiosk({ api }: { api?: string } = {}) {
  const chat = useKioskChat({ api });
  const { pendingAsks, busy } = chat;
  const health = useServiceHealth();

  const [started, setStarted] = useState(false);

  // Lives here rather than in Composer so a dictated turn can be dropped in for review.
  const [draft, setDraft] = useState("");

  // The language this citizen speaks, adopted from their recognized utterances.
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);

  const restartToWelcome = () => {
    setTries({});
    setRefusal(null);
    chat.reset();
    setDraft("");
    setLanguage(DEFAULT_LANGUAGE);
    setEnded(false);
    setStarted(false);
  };

  // Keyed by the round's ask ids so a new round resets at render time.
  const askIds = pendingAsks.map((a) => a.id).join("|");
  const [round, setRound] = useState<{
    key: string;
    answers: Record<string, string>;
    spoke: boolean;
  }>({ key: askIds, answers: {}, spoke: false });
  if (round.key !== askIds) setRound({ key: askIds, answers: {}, spoke: false });
  const picked = round.key === askIds ? round.answers : {};
  const spoke = round.key === askIds && round.spoke;
  const setPicked = (answers: Record<string, string>) =>
    setRound({ key: askIds, answers, spoke });

  const modalAsks = pendingAsks.filter((a) => a.modal);

  const finished =
    !busy &&
    pendingAsks.length === 0 &&
    (chat.flow?.status === "completed" || chat.flow?.status === "failed");

  // Latched, so a reply still trickling in behind the receipt cannot reopen the kiosk.
  const [ended, setEnded] = useState(false);
  if (finished && !ended) setEnded(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileAskId, setFileAskId] = useState<string | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages, busy]);

  const inlineAsks = pendingAsks.filter((a) => !a.modal);
  const choiceAsks = inlineAsks.filter((a) => a.type === "options");
  const textAsks = inlineAsks.filter((a) => a.type === "text");
  const activeTextAsk = textAsks.find((a) => !picked[a.id]);

  const requiredDone = inlineAsks
    .filter((a) => a.type !== "document" && !a.optional)
    .every((a) => picked[a.id]);

  const labelFor = (ask: Ask, value: string) =>
    ask.type === "action" && value === "done"
      ? (DEVICE_STEPS[ask.id]?.receipt ?? "Done at the kiosk")
      : (ask.options?.find((o) => o.value === value)?.label ?? value);

  /** `extra` carries values that answer no ask and must not be echoed into the transcript. */
  const submitRound = (answers: Record<string, string>, extra?: Record<string, string>) => {
    const shown = Object.entries(answers)
      .map(([id, value]) => labelFor(pendingAsks.find((a) => a.id === id)!, value))
      .join(" · ");
    chat.sendAnswers({ ...answers, ...extra }, shown);
  };

  const pick = (ask: Ask, value: string) => {
    const next = { ...picked, [ask.id]: value };
    setPicked(next);
    if (inlineAsks.length === 1) submitRound(next);
  };

  const handleComposer = (text: string) => {
    // Guards against a turn recognized in the gap between the request finishing and input closing.
    if (ended) return;
    // An open choice takes precedence over an open text field: words naming an option
    // ("by mykad") answer the choice, not the reference the field is waiting for.
    const matched = matchOptionAnswers(
      text,
      choiceAsks.filter((a) => !picked[a.id]),
    );
    if (Object.keys(matched).length > 0) {
      const next = { ...picked, ...matched };
      setPicked(next);
      if (inlineAsks.every((a) => a.optional || next[a.id])) submitRound(next);
      return;
    }
    if (activeTextAsk) {
      const next = { ...picked, [activeTextAsk.id]: text };
      setPicked(next);
      if (inlineAsks.every((a) => a.optional || next[a.id])) submitRound(next);
      return;
    }
    if (modalAsks.length > 0) setRound({ key: askIds, answers: picked, spoke: true });
    chat.sendText(text, language);
  };

  // The ref keeps the voice hook off this handler's per-render identity.
  const submitRef = useRef(handleComposer);
  useEffect(() => {
    submitRef.current = handleComposer;
  });

  const voice = useChatVoice({
    messages: chat.messages,
    busy,
    blocked: !started || modalAsks.length > 0 || ended,
    language,
    onLanguage: setLanguage,
    onSend: (text) => submitRef.current(text),
    onDraft: (text) => setDraft((current) => (current ? `${current} ${text}` : text)),
  });

  const speaking = voice.playback.speakingId !== null;
  const narrating = WAIT_FOR_SPEECH && speaking;

  const speakingMessage = chat.messages.find((m) => m.id === voice.playback.speakingId);
  const caption = speakingMessage ? speakableText(speakingMessage) : "";

  // Most specific first: send-off, then voice, then physical step, then spinner.
  const avatarState = ended
    ? ("celebrating" as const)
    : speaking
      ? ("speaking" as const)
      : modalAsks.length > 0
        ? ("pointing" as const)
        : busy
          ? ("thinking" as const)
          : voice.input.isListening && !voice.paused
            ? ("listening" as const)
            : ("idle" as const);

  const restart = useAutoRestart({
    when: ended,
    paused: narrating,
    onRestart: restartToWelcome,
  });

  // The clock is held while the kiosk is working, speaking, listening or waiting on hardware.
  useIdleRestart({
    enabled: started && !finished,
    paused: busy || speaking || voice.input.isSpeaking || modalAsks.length > 0,
    activity: chat.messages.length,
    onIdle: restartToWelcome,
  });

  const handleFile = async (file: File) => {
    if (!fileAskId) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    chat.sendUpload(
      { documentId: fileAskId, fileBase64: btoa(binary), fileName: file.name },
      `📎 ${file.name}`,
    );
  };

  const pickFile = (askId: string) => {
    setFileAskId(askId);
    fileRef.current?.click();
  };

  const autoCapture = DOCUMENT_SOURCE !== "upload";
  const captureServiceId = chat.flow?.serviceId;
  // Keyed by service so one service's refusals never count against another's.
  const [tries, setTries] = useState<Record<string, number>>({});
  const tryKey = (askId: string) => `${captureServiceId ?? ""}:${askId}`;
  const outOfTries = (askId: string) => (tries[tryKey(askId)] ?? 0) >= MAX_AUTO_CAPTURES;
  const captureAsk = autoCapture
    ? pendingAsks.find((a) => a.type === "document" && !outOfTries(a.id))
    : undefined;
  const captureAskId = captureAsk?.id;
  // Capture starts immediately, narration or no: a scan only picks up paper fed after it starts.
  const [captured, setCaptured] = useState<FlowUpload | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const holding = refusal !== null;
  useEffect(() => {
    if (!captureAskId || busy || holding) return;
    let cancelled = false;
    let again: ReturnType<typeof setTimeout> | undefined;
    const key = `${captureServiceId ?? ""}:${captureAskId}`;
    const countTry = () =>
      setTries((counted) => ({ ...counted, [key]: (counted[key] ?? 0) + 1 }));
    const capture =
      DOCUMENT_SOURCE === "scanner"
        ? waitForScannedDocument(captureServiceId ?? "", captureAskId)
        : getMockDocument(captureServiceId ?? "", captureAskId);
    capture
      .then((doc) => {
        if (cancelled) return;
        setCaptureStatus(null);
        setCaptured({
          documentId: captureAskId,
          fileBase64: doc.fileBase64,
          fileName: doc.fileName,
        });
        // Counts whatever the check makes of it: the next capture would hand over the same bytes.
        countTry();
      })
      .catch((error: Error) => {
        // Nothing was fed in — ask again, but count it so empty waits eventually give up.
        if (cancelled) return;
        setCaptureStatus({
          askId: captureAskId,
          message:
            error.message ||
            (DOCUMENT_SOURCE === "scanner"
              ? "The scanner did not receive a page."
              : "The document could not be prepared."),
        });
        countTry();
        again = setTimeout(() => {
          setCaptureStatus(null);
          setAttempt((n) => n + 1);
        }, RECAPTURE_MS);
      });
    return () => {
      cancelled = true;
      clearTimeout(again);
    };
  }, [captureAskId, captureServiceId, busy, attempt, holding]);

  const sentRef = useRef<FlowUpload | null>(null);
  // How many replies had landed when the document went: the next reply is its verdict.
  const verdictRef = useRef<{ askId: string; replies: number } | null>(null);
  const replies = chat.messages.reduce((n, m) => n + (m.role === "assistant" ? 1 : 0), 0);
  useEffect(() => {
    if (!captured || busy || narrating || sentRef.current === captured) return;
    if (!pendingAsks.some((a) => a.id === captured.documentId && a.type === "document")) return;
    sentRef.current = captured;
    verdictRef.current = { askId: captured.documentId, replies };
    chat.sendUpload(captured, `📄 ${captured.fileName}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chat identity churns per render
  }, [captured, busy, narrating, askIds]);

  const turnFailed = Boolean(chat.failed);
  useEffect(() => {
    const sent = verdictRef.current;
    // A turn that never came back is not a verdict: the flow on screen predates the upload.
    if (!sent || busy || turnFailed || replies <= sent.replies) return;
    verdictRef.current = null;
    if (!pendingAsks.some((a) => a.id === sent.askId && a.type === "document")) return;
    setRefusal({ askId: sent.askId, secondsLeft: REFUSAL_HOLD_SECONDS });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asks are compared by id
  }, [busy, turnFailed, replies, askIds]);

  useEffect(() => {
    if (!refusal) return;
    const tick = setTimeout(
      () =>
        setRefusal((left) =>
          left && left.secondsLeft > 1 ? { ...left, secondsLeft: left.secondsLeft - 1 } : null,
        ),
      1_000,
    );
    return () => clearTimeout(tick);
  }, [refusal]);

  if (health.unavailable) {
    return <ServiceUnavailableScreen />;
  }

  if (!started) {
    return <WelcomeScreen onBegin={() => setStarted(true)} />;
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center justify-between border-b bg-card px-6 py-4">
        <KioskBrand />
        <div className="flex items-center gap-3">
          <ModeToggle className="flex size-11 items-center justify-center rounded-full border transition-colors hover:border-ring" />
          <ThemeToggle className="flex size-11 items-center justify-center rounded-full border transition-colors hover:border-ring" />
          <button
            onClick={restartToWelcome}
            className="flex items-center gap-2 rounded-full border px-5 py-2.5 text-base font-semibold text-muted-foreground transition-colors hover:border-ring hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className="size-5" />
            Restart
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-5 p-5 portrait:flex-col landscape:flex-row">
        <AvatarPanel
          className="shrink-0 portrait:h-[32%] landscape:w-[30%] landscape:max-w-md landscape:min-w-80"
          state={avatarState}
          caption={caption}
          progress={voice.playback.progress}
        />

        <div className="landscape:ks-rest flex min-h-0 min-w-0 flex-1 flex-col portrait:gap-5 landscape:overflow-hidden landscape:rounded-3xl landscape:border landscape:bg-card">
          <div className="relative min-h-0 flex-1">
            <div ref={scrollRef} className="h-full overflow-y-auto">
              <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end gap-4 px-4 py-6">
                <Bubble role="bot">{WELCOME_COPY}</Bubble>

            {chat.messages.map((message, index) => (
              <Message
                key={message.id}
                message={message}
                beingRead={voice.playback.speakingId === message.id}
                voice={
                  voice.canSpeak && !(busy && index === chat.messages.length - 1)
                    ? voice
                    : undefined
                }
              />
            ))}
            {busy && modalAsks.length === 0 && (
              <div className="flex items-center gap-3 text-muted-foreground">
                <Spinner className="size-5" />
                <span className="text-base">Working on it…</span>
              </div>
            )}

            {chat.failed && !busy && !ended && modalAsks.length === 0 && (
              <TurnFailed onRetry={chat.retry} />
            )}

            {!busy && inlineAsks.length > 0 && (
              <div className="flex animate-ks-fade flex-col gap-5 rounded-3xl border-2 border-ring/40 bg-card p-5">
                <ActionHint
                  icon={MousePointerClick}
                  direction={choiceAsks.length > 0 ? "none" : "down"}
                  className="mx-0 mb-0 self-start"
                >
                  {choiceAsks.length > 0 && textAsks.length > 0
                    ? "Tap an answer below, then type the rest — or just say it out loud"
                    : choiceAsks.length > 0
                      ? "Tap an answer below — or just say it out loud"
                      : "Type your answer in the box at the bottom — or say it out loud"}
                </ActionHint>
                {choiceAsks.map((ask) => (
                  <div key={ask.id}>
                    <div className="mb-2.5 text-base font-semibold">{ask.question}</div>
                    <div className="ks-stagger flex flex-wrap gap-2.5">
                      {ask.options?.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => pick(ask, option.value)}
                          className={cn(
                            "flex items-center gap-2 rounded-2xl border px-5 py-3 text-left text-base font-medium",
                            "transition-[transform,background-color,border-color] duration-200",
                            "hover:-translate-y-0.5 hover:border-ring",
                            picked[ask.id] === option.value
                              ? "border-primary bg-primary/10 text-primary"
                              : "bg-field",
                          )}
                        >
                          {picked[ask.id] === option.value && (
                            <Check className="size-4 animate-ks-pop" strokeWidth={3} />
                          )}
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {textAsks.map((ask) => (
                  <div key={ask.id} className="text-base">
                    <span className="font-semibold">{ask.question}</span>{" "}
                    {picked[ask.id] ? (
                      <span className="inline-flex items-center gap-1.5 text-primary">
                        <Check className="size-4" strokeWidth={3} />
                        {picked[ask.id]}
                      </span>
                    ) : ask === activeTextAsk ? (
                      <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
                        <ArrowDown className="size-4 animate-ks-nudge text-primary" />
                        type your answer below
                        <span className="inline-block h-4 w-0.5 animate-ks-caret bg-primary align-middle" />
                      </span>
                    ) : null}
                  </div>
                ))}
                {inlineAsks.length > 1 && requiredDone && (
                  <Button
                    className="ks-attention-ring h-12 animate-ks-pop self-start rounded-2xl px-6 text-base font-semibold"
                    onClick={() => submitRound(picked)}
                  >
                    <Check className="size-5" />
                    Continue
                  </Button>
                )}
              </div>
            )}

            {ended && (
              <RestartNotice
                secondsLeft={restart.secondsLeft}
                onNow={restartToWelcome}
                onHold={restart.hold}
              />
            )}

            {!busy && !ended && pendingAsks.length === 0 && (
              <div className="flex flex-wrap gap-2.5">
                {SERVICES.map((service) => (
                  <button
                    key={service.id}
                    onClick={() => chat.startService(service.id, service.label)}
                    className="rounded-full border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
                  >
                    {service.label}
                  </button>
                ))}
                <button
                  onClick={() => chat.startService(REQUESTS_FLOW_ID, "My Requests")}
                  className="rounded-full border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
                >
                  My Requests
                </button>
              </div>
            )}
              </div>
            </div>

            {modalAsks.length > 0 && (
              <StepOverlay
                asks={modalAsks}
                busy={busy}
                speaking={narrating}
                narrated={voice.canSpeak}
                manualAskIds={modalAsks
                  .filter((a) => a.type === "document" && outOfTries(a.id))
                  .map((a) => a.id)}
                spoke={spoke}
                turn={chat.messages.length}
                captureStatus={
                  captureStatus
                    ? {
                        ...captureStatus,
                        triesLeft: Math.max(
                          0,
                          MAX_AUTO_CAPTURES - (tries[tryKey(captureStatus.askId)] ?? 0),
                        ),
                      }
                    : null
                }
                refusal={refusal}
                failed={Boolean(chat.failed)}
                onRetry={chat.retry}
                onConfirm={(ask, extra) => submitRound({ [ask.id]: "done" }, extra)}
                onOption={(ask, value) => submitRound({ [ask.id]: value })}
                onUpload={pickFile}
              />
            )}
          </div>

          <Composer
            busy={busy}
            locked={ended}
            awaiting={Boolean(activeTextAsk)}
            placeholder={
              ended
                ? "This request is finished — start over to begin a new one."
                : activeTextAsk
                  ? (activeTextAsk.placeholder ?? "Type your answer…")
                  : modalAsks.length > 0
                    ? "Ask me about this step…"
                    : "Tell me what you need…"
            }
            value={draft}
            onValueChange={setDraft}
            onSubmit={handleComposer}
            mic={voice.canListen && !ended ? <MicButton voice={voice} disabled={busy} /> : null}
            error={ended ? null : voice.input.error}
            status={ended ? null : micStatusText(voice)}
          />
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}

/** Covers the transcript while a physical step waits; nothing dismisses it but the step finishing. */
function StepOverlay({
  asks,
  busy,
  speaking,
  narrated,
  manualAskIds,
  spoke,
  turn,
  captureStatus,
  refusal,
  failed,
  onRetry,
  onConfirm,
  onOption,
  onUpload,
}: {
  asks: Ask[];
  busy: boolean;
  speaking: boolean;
  narrated: boolean;
  failed: boolean;
  onRetry: () => void;
  /** Documents the kiosk has stopped capturing by itself — see MAX_AUTO_CAPTURES. */
  manualAskIds: string[];
  spoke: boolean;
  /** Bumps every turn. A step asked again did not succeed, so it must re-arm. */
  turn: number;
  captureStatus: CaptureStatus | null;
  refusal: Refusal | null;
  /** `extra` rides along with the confirmation — values that answer no ask. */
  onConfirm: (ask: Ask, extra?: Record<string, string>) => void;
  onOption: (ask: Ask, value: string) => void;
  onUpload: (askId: string) => void;
}) {
  // Detection is armed only once the kiosk has finished narrating the step.
  const held = busy || speaking;

  return (
    <div
      // A region, not a `dialog`: the composer underneath stays usable, so this is not modal.
      role="region"
      aria-label="Action needed at the kiosk"
      className={cn(
        "absolute inset-0 z-30 flex animate-ks-fade items-center justify-center p-4 sm:p-8",
        "bg-[color:var(--overlay)] supports-backdrop-filter:backdrop-blur-md",
        // In portrait there is no card to clip against, so the scrim rounds its own corners.
        "portrait:rounded-3xl",
      )}
    >
      <div
        className={cn(
          "ks-attention-ring flex max-h-full w-full max-w-4xl animate-ks-pop flex-col gap-7",
          "overflow-y-auto rounded-[2rem] border-2 border-primary/40 bg-popover p-6",
          "shadow-[var(--shadow-lift)] sm:p-9",
        )}
      >
        <div>
          <div className="flex items-center gap-3 text-xl font-bold tracking-tight lg:text-2xl">
            <span className="size-3 animate-ks-blink rounded-full bg-cyan shadow-[0_0_14px_var(--color-cyan)]" />
            Your turn at the kiosk
          </div>
          <p className="mt-1.5 text-lg text-pretty text-muted-foreground">
            Do {asks.length > 1 ? "these" : "this"} on the machine in front of you — the kiosk
            picks up where you left off automatically.
          </p>
          {narrated && (
            <p className="mt-2.5 flex items-center gap-2.5 text-base text-pretty text-muted-foreground">
              <Volume2 className="size-5 shrink-0 text-primary" />
              I&apos;m reading this step aloud — ask me below if you&apos;re stuck.
            </p>
          )}
        </div>
        {asks.map((ask, index) => (
          <div
            key={ask.id}
            className={cn(index > 0 && "border-t pt-7")}
          >
            {ask.id === BIOMETRIC_ASK_ID ? (
              <FaceAsk
                ask={ask}
                held={held}
                spoke={spoke}
                turn={turn}
                onDone={(frame) => onConfirm(ask, frame ? { faceFrame: frame } : undefined)}
              />
            ) : (
              <AskRow
                ask={ask}
                busy={busy}
                held={held}
                manual={manualAskIds.includes(ask.id)}
                spoke={spoke}
                captureStatus={captureStatus?.askId === ask.id ? captureStatus : null}
                refusal={refusal?.askId === ask.id ? refusal : null}
                turn={turn}
                onConfirm={onConfirm}
                onOption={onOption}
                onUpload={onUpload}
              />
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Spinner className="size-6" />
            <span className="text-lg">Processing…</span>
          </div>
        )}
        {failed && !busy && <TurnFailed onRetry={onRetry} />}
      </div>
    </div>
  );
}

function TurnFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex animate-ks-fade flex-col gap-3 rounded-3xl border border-destructive/40 bg-destructive/10 p-5 text-left">
      <div className="flex items-start gap-2.5 text-base font-medium text-destructive">
        <CircleAlert className="mt-0.5 size-5 shrink-0" />
        <span className="text-pretty">
          The kiosk hit a problem and didn&apos;t finish answering. Nothing you did was lost —
          tap Try again to continue, or ask a staff member if this keeps happening.
        </span>
      </div>
      <Button
        variant="outline"
        className="h-12 self-start rounded-2xl px-5 text-base font-semibold"
        onClick={onRetry}
      >
        <RotateCcw className="size-5" />
        Try again
      </Button>
    </div>
  );
}

/** Detection window that holds where it is while the kiosk talks and resumes from there. */
function useDetectionWindow({
  ms,
  paused,
  arm,
  onDetected,
}: {
  /** Undefined for a step the hardware does not detect by itself. */
  ms: number | undefined;
  paused: boolean;
  /** Only a bump here refills the window — deliberately NOT the turn counter. */
  arm: number;
  onDetected: () => void;
}) {
  const remaining = useRef(ms ?? 0);
  const armed = useRef(arm);
  const fire = useRef(onDetected);
  useEffect(() => {
    fire.current = onDetected;
  });
  useEffect(() => {
    // Refilled before the paused check: the previous run's cleanup already banked the remainder.
    if (armed.current !== arm) {
      armed.current = arm;
      remaining.current = ms ?? 0;
    }
    if (!ms || paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => fire.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [ms, paused, arm]);
}

/** Long-poll window the server waits at the reader; short enough that pausing is honoured promptly. */
const CARD_POLL_MS = 5_000;

const CARD_REMOVAL_POLL_MS = 700;

/** `/identity/card` distinguishes "no card yet" (404) from "no working reader" (503);
 *  only the latter lets the timer stand in for the hardware. */
function useCardWatch({
  enabled,
  paused,
  arm,
  onDetected,
}: {
  enabled: boolean;
  paused: boolean;
  arm: number;
  onDetected: () => void;
}): { unavailable: boolean } {
  const [unavailable, setUnavailable] = useState(false);
  const fire = useRef(onDetected);
  useEffect(() => {
    fire.current = onDetected;
  });

  useEffect(() => {
    if (!enabled || paused) return;
    const control = new AbortController();
    let live = true;

    void (async () => {
      try {
        // A refused card is usually still in the slot, so a retry waits for it to be removed.
        while (live && arm > 0 && (await cardOnReader(control.signal))) {
          await new Promise<void>((r) => setTimeout(() => r(), CARD_REMOVAL_POLL_MS));
        }
        while (live) {
          try {
            await readCard(CARD_POLL_MS, control.signal);
            if (live) fire.current();
            return;
          } catch (error) {
            // 404 means nothing was presented in that window — keep waiting.
            if (!(error instanceof ApiError) || error.status !== 404) throw error;
          }
        }
      } catch {
        // No reader, no PC/SC daemon, or simulating: fall back to the timer.
        if (live) setUnavailable(true);
      }
    })();

    return () => {
      live = false;
      control.abort();
    };
  }, [enabled, paused, arm]);

  return { unavailable };
}

/** Is a card sitting on the reader right now? `timeout=0` asks without waiting. */
async function cardOnReader(signal: AbortSignal): Promise<boolean> {
  try {
    await readCard(0, signal);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return false;
    throw error;
  }
}

const DOCUMENT_HELP =
  "The document has to reach the kiosk as a file — fed into the scanner beside the " +
  "screen, or picked with the button on this card. A staff member at the counter can " +
  "take it if neither works.";

/** What the kiosk says back when a physical step is answered with words. */
function StepNag({
  help,
  intro,
  openHelp,
  children,
}: {
  help: string;
  /** Replaces the "you answered in words" line — also used when a step keeps failing. */
  intro?: string;
  openHelp?: boolean;
  children: React.ReactNode;
}) {
  const [stuck, setStuck] = useState(openHelp ?? false);
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-left">
      <p className="text-lg text-pretty">{intro ?? DEVICE_STEP_REPLY}</p>
      <div className="flex flex-wrap gap-3">
        {children}
        <Button
          variant="outline"
          className="h-13 rounded-2xl px-6 text-lg"
          onClick={() => setStuck((open) => !open)}
        >
          <CircleHelp className="size-6" />
          I can&apos;t do this
        </Button>
      </div>
      {stuck && <p className="text-lg text-pretty text-muted-foreground">{help}</p>}
    </div>
  );
}

/** Drawn as an alert only when the note is a refusal. */
function StepNote({ text, tone }: { text: string; tone: Ask["noteTone"] }) {
  const alert = tone === "alert";
  const Icon = alert ? CircleAlert : IdCard;
  return (
    <div
      className={cn(
        "mt-4 flex items-start gap-2.5 rounded-2xl px-4 py-3 text-left text-base font-medium",
        alert ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0" />
      <span className="text-pretty">{text}</span>
    </div>
  );
}

/** One physical step: a picture of the hardware, the instruction, and however the citizen answers. */
function AskRow({
  ask,
  busy,
  held,
  manual,
  spoke,
  captureStatus,
  refusal,
  turn,
  onConfirm,
  onOption,
  onUpload,
}: {
  ask: Ask;
  busy: boolean;
  held: boolean;
  /** The kiosk has given up capturing this document itself — see MAX_AUTO_CAPTURES. */
  manual: boolean;
  spoke: boolean;
  captureStatus: CaptureStatus | null;
  refusal: Refusal | null;
  /** Bumps every turn. A step asked again did not succeed, so it must re-arm. */
  turn: number;
  onConfirm: (ask: Ask) => void;
  onOption: (ask: Ask, value: string) => void;
  onUpload: (askId: string) => void;
}) {
  const step = DEVICE_STEPS[ask.id];
  // The turn is recorded, not a bare flag: a later turn with the step still pending re-arms it.
  const [detectedAt, setDetectedAt] = useState<number | null>(null);
  const detected = detectedAt !== null;
  const [attempts, setAttempts] = useState(0);
  if (detectedAt !== null && turn !== detectedAt) {
    setDetectedAt(null);
    setAttempts((n) => n + 1);
  }

  // Only the card step has real hardware to wait on; the rest run a timer, and so does it
  // once the reader reports itself unavailable.
  const isCardStep = ask.id === "insertDocument" && ask.type === "action";
  const { unavailable: noReader } = useCardWatch({
    enabled: isCardStep,
    paused: held || detected,
    arm: attempts,
    onDetected: () => setDetectedAt(turn),
  });
  const simulated = isCardStep && noReader;

  useDetectionWindow({
    ms: ask.type === "action" && (!isCardStep || noReader) ? ask.autoAdvanceMs : undefined,
    paused: held || detected,
    arm: attempts,
    onDetected: () => setDetectedAt(turn),
  });

  const confirmRef = useRef(onConfirm);
  useEffect(() => {
    confirmRef.current = onConfirm;
  });
  useEffect(() => {
    if (!detected) return;
    const timer = setTimeout(() => confirmRef.current(ask), DONE_HOLD_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one ask per row, keyed by id
  }, [detected]);

  // A step refused twice will not be argued into working — put the help on screen.
  const stalled = attempts >= 2 && !detected;

  const scanning = ask.type === "document" && DOCUMENT_SOURCE === "scanner" && !manual;
  // A refusal parks the hardware too, so the scanner isn't pulling paper the kiosk won't read.
  const state: DeviceState = detected ? "done" : held || refusal ? "paused" : "waiting";
  const visual =
    ask.id === "insertDocument" ? (
      ID_GESTURE === "tap" ? (
        <ContactlessVisual state={state} />
      ) : (
        <CardReaderVisual state={state} />
      )
    ) : ask.id === "payment" ? (
      <ContactlessVisual state={state} />
    ) : scanning ? (
      <ScannerVisual state={state} />
    ) : null;

  return (
    <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-center sm:gap-8 sm:text-left">
      {visual ? (
        <div className="flex shrink-0 justify-center sm:w-56">{visual}</div>
      ) : (
        <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
          <AskIcon ask={ask} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xl font-semibold text-pretty break-words lg:text-2xl">{ask.question}</p>
        {detected ? (
          <div className="mt-4 flex items-center justify-center gap-3 text-lg font-semibold text-success sm:justify-start">
            <Check className="size-6 animate-ks-pop" strokeWidth={3} />
            {simulated ? NO_READER_COPY.detected : (step?.detected ?? "Detected — continuing…")}
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap justify-center gap-3 sm:justify-start">
            {ask.type === "action" &&
              (isCardStep && !noReader ? (
                <ReaderWaiting held={held} />
              ) : ask.autoAdvanceMs ? (
                <DetectionBar
                  ms={ask.autoAdvanceMs}
                  held={held}
                  label={
                    simulated
                      ? NO_READER_COPY.waiting
                      : ask.id === "payment"
                        ? "Waiting for your payment…"
                        : "Waiting for the kiosk to detect this…"
                  }
                />
              ) : (
                <Button
                  className="ks-attention-ring h-14 rounded-2xl px-7 text-lg font-semibold"
                  disabled={busy}
                  onClick={() => setDetectedAt(turn)}
                >
                  <Check className="size-6" />
                  Done — continue
                </Button>
              ))}
            {ask.type === "options" &&
              ask.options?.map((option) => (
                <Button
                  key={option.value}
                  variant="outline"
                  className="h-14 rounded-2xl px-7 text-lg transition-transform hover:-translate-y-0.5"
                  disabled={busy}
                  onClick={() => onOption(ask, option.value)}
                >
                  {option.label}
                </Button>
              ))}
            {ask.type === "document" &&
              (DOCUMENT_SOURCE !== "upload" && !manual ? (
                !busy &&
                (refusal ? (
                  <div className="flex max-w-xl flex-col gap-1.5" role="status" aria-live="assertive">
                    <span className="flex items-center gap-2.5 text-lg font-semibold text-destructive">
                      <CircleAlert className="size-6 shrink-0" />
                      That document was not valid.
                    </span>
                    <span className="text-lg text-pretty text-muted-foreground">
                      {scanning
                        ? `Take it back out of the scanner and have the right one ready — scanning again in ${refusal.secondsLeft}…`
                        : `Trying again in ${refusal.secondsLeft}…`}
                    </span>
                  </div>
                ) : captureStatus ? (
                  <div className="max-w-xl text-lg text-warning" role="status">
                    {captureStatus.message}{" "}
                    {scanning
                      ? "Check that the page is in the scanner — trying again"
                      : "Trying again"}
                    {captureStatus.triesLeft
                      ? ` (${captureStatus.triesLeft} ${
                          captureStatus.triesLeft === 1 ? "try" : "tries"
                        } left before you pick the file yourself)`
                      : ""}
                    …
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-muted-foreground" aria-live="polite">
                    {scanning ? <Spinner className="size-6 text-primary" /> : <WaitingDots className="text-primary" />}
                    <span className="text-lg">{scanning ? "Scanning your document…" : "Preparing the document…"}</span>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center gap-3 sm:items-start">
                  {manual && (
                    <p className="text-lg text-pretty text-muted-foreground">
                      The kiosk tried this document {MAX_AUTO_CAPTURES} times and it was not
                      accepted — please choose the file yourself, or ask a staff member at the
                      counter.
                    </p>
                  )}
                  <Button
                    variant="outline"
                    className="ks-attention-ring h-14 rounded-2xl px-7 text-lg"
                    disabled={busy}
                    onClick={() => onUpload(ask.id)}
                  >
                    <Paperclip className="size-6 animate-ks-nudge" />
                    Choose a PDF
                  </Button>
                </div>
              ))}
          </div>
        )}
        {ask.note && !detected && <StepNote text={ask.note} tone={ask.noteTone} />}
        {(spoke || stalled) && !detected && (
          <StepNag
            help={step?.help ?? DOCUMENT_HELP}
            intro={
              stalled && !spoke
                ? "The kiosk has tried this twice and the step has not passed. It may not be " +
                  "something you can fix from here."
                : undefined
            }
            openHelp={stalled && !spoke}
          >
            {ask.type === "action" ? (
              <Button
                className="ks-attention-ring h-13 rounded-2xl px-6 text-lg font-semibold"
                disabled={busy}
                onClick={() => setDetectedAt(turn)}
              >
                <Check className="size-6" />
                {step?.confirm ?? "I've done it — continue"}
              </Button>
            ) : (
              <Button
                className="ks-attention-ring h-13 rounded-2xl px-6 text-lg font-semibold"
                disabled={busy}
                onClick={() => onUpload(ask.id)}
              >
                <Paperclip className="size-6" />
                Choose a PDF instead
              </Button>
            )}
          </StepNag>
        )}
      </div>
    </div>
  );
}

function AskIcon({ ask }: { ask: Ask }) {
  const Icon = ask.id === "insertDocument" ? IdCard : ask.id === "payment" ? Wallet : ScanFace;
  return <Icon className="size-8 text-primary" />;
}

/** The face check in the conversation. Deliberately shows no local tick — the match is
 *  decided on the server against the registry portrait. */
function FaceAsk({
  ask,
  held,
  spoke,
  turn,
  onDone,
}: {
  ask: Ask;
  held: boolean;
  spoke: boolean;
  turn: number;
  /** Handed the captured JPEG data URL, or null when there was no camera. */
  onDone: (frame: string | null) => void;
}) {
  // Recording the turn rather than a bare flag keeps the reset below exact: a turn the
  // citizen caused by typing at the composer must not look like an answer to the scan.
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const captured = capturedAt !== null;

  const scan = useFaceScanSequence({
    enabled: true,
    paused: held,
    outcome: "pending",
    onCapture: (frame) => {
      setCapturedAt(turn);
      onDone(frame);
    },
  });

  // A turn landing after the frame was sent, with this step still asked, means the frame
  // did not settle it — without re-arming the step sits on "Checking…" for ever.
  const retry = capturedAt !== null && turn !== capturedAt;
  if (retry) {
    setCapturedAt(null);
    scan.restart();
  }

  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (!scan.blocked || held || captured) return;
    const timer = setTimeout(() => {
      setCapturedAt(turn);
      doneRef.current(null);
    }, ask.autoAdvanceMs ?? 2_300);
    return () => clearTimeout(timer);
  }, [scan.blocked, held, captured, turn, ask.autoAdvanceMs]);

  // A blocked camera must say so rather than leaving "Starting the camera…" up while the
  // step quietly answers itself.
  const copy = scan.blocked
    ? {
        caption:
          scan.cameraStatus === "denied"
            ? "The camera is blocked"
            : "No camera is available",
        hint:
          "This kiosk cannot run the face scan, so verification continues without it — " +
          "a staff member may ask to confirm your identity instead.",
      }
    : facePhaseCopy(scan.phase);

  return (
    <div className="flex flex-col items-center gap-7 text-center sm:flex-row sm:items-center sm:gap-9 sm:text-left">
      <div className="flex shrink-0 justify-center">
        {scan.blocked ? (
          <div className="flex size-16 items-center justify-center rounded-2xl bg-warning/10">
            <CameraOff className="size-8 text-warning" />
          </div>
        ) : (
          <FaceViewport phase={scan.phase} videoRef={scan.videoRef} live={scan.live} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xl font-semibold text-pretty break-words lg:text-2xl">{ask.question}</p>
        <div className="mt-4 flex flex-col items-center gap-3 sm:items-start">
          <div className="text-2xl font-bold tracking-tight text-primary lg:text-3xl">
            {copy.caption}
          </div>
          <p className="text-lg text-pretty text-muted-foreground">{copy.hint}</p>
          {ask.note && <StepNote text={ask.note} tone={ask.noteTone} />}
          {spoke && !captured && (
            <StepNag help={DEVICE_STEPS.biometric.help}>
              <Button
                className="ks-attention-ring h-13 rounded-2xl px-6 text-lg font-semibold"
                onClick={() => {
                  setCapturedAt(turn);
                  onDone(captureFrame(scan.videoRef.current));
                }}
              >
                <Check className="size-6" />
                {DEVICE_STEPS.biometric.confirm}
              </Button>
            </StepNag>
          )}
          {scan.canSkip && !held && (
            <Button
              variant="outline"
              className="h-13 rounded-2xl px-6 text-lg font-semibold"
              onClick={scan.scanNow}
            >
              <ScanFace className="size-6" />
              I&apos;m ready — scan now
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The card step's wait, drawn without a bar: this wait ends when a card reaches the
 *  reader, so a filling bar would promise a duration nobody can predict. */
function ReaderWaiting({ held }: { held: boolean }) {
  return (
    <div className="flex items-center gap-3 text-muted-foreground" aria-live="polite">
      <WaitingDots className="text-primary" />
      <span className="text-lg">
        {held ? "Listen to the instructions first…" : "Waiting for your card…"}
      </span>
    </div>
  );
}

/** A filling bar over a hardware detection window. While the kiosk talks the bar freezes
 *  where it stands and resumes from there — see `useDetectionWindow`. */
function DetectionBar({ ms, held, label }: { ms: number; held: boolean; label: string }) {
  return (
    <div className="flex w-full flex-col items-center gap-2.5 sm:items-start">
      <div className="flex items-center gap-3 text-muted-foreground">
        <WaitingDots className="text-primary" />
        <span className="text-lg">{held ? "Listen to the instructions first…" : label}</span>
      </div>
      <div className="h-2.5 w-full max-w-sm overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "ks-gradient h-full origin-left animate-ks-fill",
            held && "[animation-play-state:paused]",
          )}
          style={{ animationDuration: `${ms}ms` }}
        />
      </div>
    </div>
  );
}

/** The wipe between citizens, announced with a way out. */
function RestartNotice({
  secondsLeft,
  onNow,
  onHold,
}: {
  /** Null once the citizen has held the clock — nothing is counting. */
  secondsLeft: number | null;
  onNow: () => void;
  onHold: () => void;
}) {
  const counting = secondsLeft !== null;
  return (
    <div className="flex flex-col gap-3.5 rounded-3xl border bg-card p-5">
      <div>
        <div className="text-base font-semibold">All done — thank you!</div>
        <p className="text-base text-muted-foreground text-pretty">
          {counting
            ? `This chat resets for the next person in ${secondsLeft}s.`
            : "Take your time. Tap Start over when you're ready — that begins a new " +
              "request, for you or for the next person."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <Button className="h-11 rounded-2xl px-5 text-base font-semibold" onClick={onNow}>
          <RotateCcw className="size-5" />
          Start over now
        </Button>
        {counting && (
          <Button variant="outline" className="h-11 rounded-2xl px-5 text-base" onClick={onHold}>
            <Clock className="size-5" />
            I need more time
          </Button>
        )}
      </div>
    </div>
  );
}

/** A device confirm or a self-captured document is something the machine did, so it renders
 *  as a completed step rather than as the citizen saying "done". */
function stepReceipt(message: KioskUIMessage): string | null {
  const metadata = message.metadata;
  if (!metadata) return null;
  if (metadata.uploads?.length) {
    return messageText(message).replace(/^[📄📎]\s*/u, "") || "Document captured";
  }
  const answers = metadata.answers ?? {};
  // Only device-step confirms count — extras like `faceFrame` ride along in the same map.
  const ids = Object.keys(answers).filter((id) => id in DEVICE_STEPS && answers[id] === "done");
  if (ids.length === 0) return null;
  return ids.map((id) => DEVICE_STEPS[id].receipt).join(" · ");
}

function Message({
  message,
  beingRead,
  voice,
}: {
  message: KioskUIMessage;
  beingRead?: boolean;
  /** Set when text-to-speech is up and this reply is complete. */
  voice?: ChatVoice;
}) {
  const text = messageText(message);
  if (message.role === "user") {
    const receipt = stepReceipt(message);
    if (receipt) return <StepReceipt>{receipt}</StepReceipt>;
    return text ? <Bubble role="user">{text}</Bubble> : null;
  }
  return (
    <>
      {message.parts.map((part, index) => {
        if (part.type === "text" && part.text) {
          // This reply is drawn inside the step panel instead. Prefix-matched because
          // the text arrives word by word.
          const streamed = part.text.trim();
          if (streamed.length >= 20 && DEVICE_STEP_REPLY.startsWith(streamed)) return null;
          return (
            <Bubble key={index} role="bot" dimmed={beingRead}>
              {part.text}
            </Bubble>
          );
        }
        if (part.type === "data-flow") {
          const flow = part.data as FlowResponse;
          return flow.receipt ? <ReceiptCard key={index} flow={flow} /> : null;
        }
        return null;
      })}
      {voice && text && (
        <SpeakButton
          voice={voice}
          messageId={message.id}
          text={speakableText(message)}
          language={narrationLanguage(message, voice.language)}
        />
      )}
    </>
  );
}

/** A step of the service, finished. */
function StepReceipt({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex animate-ks-fade items-center gap-2.5 self-center rounded-full border border-success/40 bg-success/10 px-4 py-2 text-sm font-semibold text-success">
      <Check className="size-4 shrink-0" strokeWidth={3} />
      {children}
    </div>
  );
}

function Bubble({
  role,
  dimmed,
  children,
}: {
  role: "user" | "bot";
  dimmed?: boolean;
  children: React.ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div
      className={cn(
        "flex transition-opacity duration-500",
        isUser ? "justify-end" : "justify-start",
        dimmed && "opacity-50",
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-3xl px-5 py-3.5 text-base whitespace-pre-line",
          isUser ? "ks-gradient text-on-accent" : "border bg-card",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function ReceiptCard({ flow }: { flow: FlowResponse }) {
  const receipt = flow.receipt!;
  return (
    <div className="max-w-[85%] rounded-3xl border bg-card p-5 text-base">
      <Row label="Case ID" value={receipt.caseId} strong />
      <Row label="Service" value={flow.serviceLabel} />
      <Row
        label="Amount paid"
        value={
          receipt.payment
            ? `${receipt.payment.currency} ${receipt.payment.amount.toFixed(2)} (${receipt.payment.method})`
            : "No fee"
        }
      />
      <Row label="Status" value={receipt.status.replaceAll("_", " ")} />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-6 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right font-medium", strong && "font-bold text-primary")}>
        {value}
      </span>
    </div>
  );
}

/** The one place typed citizen input enters the chat. The `mic` slot carries the voice
 *  controls; a dictated turn lands here as editable text. */
function Composer({
  busy,
  locked,
  awaiting,
  placeholder,
  value,
  onValueChange,
  onSubmit,
  mic,
  error,
  status,
}: {
  busy: boolean;
  /** The conversation is over — the box stays, dead, rather than vanishing. */
  locked?: boolean;
  awaiting?: boolean;
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (text: string) => void;
  mic?: React.ReactNode;
  error?: string | null;
  status?: string | null;
}) {
  const submit = () => {
    const text = value.trim();
    if (!text || busy || locked) return;
    onValueChange("");
    onSubmit(text);
  };
  return (
    <div className="portrait:ks-rest bg-card px-4 py-4 portrait:rounded-3xl portrait:border landscape:border-t">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
        {mic}
        <input
          value={locked ? "" : value}
          disabled={locked}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={placeholder}
          className={cn(
            "h-13 flex-1 rounded-2xl border bg-field px-5 text-base outline-none transition-colors",
            "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40",
            awaiting && "ks-attention-ring border-ring",
            locked && "cursor-not-allowed opacity-60",
          )}
        />
        <Button
          className="size-13 rounded-2xl"
          disabled={busy || locked || !value.trim()}
          onClick={submit}
          aria-label="Send"
        >
          {busy ? <Spinner className="size-5" /> : <SendHorizontal className="size-5" />}
        </Button>
      </div>
      {(error || status) && (
        <p
          className={cn(
            "mx-auto mt-2 w-full max-w-3xl text-sm",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {error ?? status}
        </p>
      )}
    </div>
  );
}
