// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, MessagesSquare, RotateCcw } from "lucide-react";
import type { Ask, FlowUpload } from "@/app/api/_lib/flows/types";
import { KioskBrand } from "@/components/kiosk/kiosk-brand";
import { PayBalanceOffer } from "@/components/kiosk/pay-balance-offer";
import { ServiceUnavailableScreen } from "@/components/kiosk/service-unavailable-screen";
import { ModeToggle } from "@/components/kiosk/mode-toggle";
import { ThemeToggle } from "@/components/kiosk/theme-toggle";
import { WelcomeScreen } from "@/components/kiosk/welcome-screen";
import { Spinner } from "@/components/ui/spinner";
import { useAutoRestart, useIdleRestart } from "@/hooks/use-auto-restart";
import { useService, useServiceHealth } from "@/hooks/use-kiosk-api";
import { documentSource } from "@/lib/api/kiosk";
import { getMockDocument, waitForScannedDocument } from "./api";
import { publicBoolean, publicEnv } from "@/lib/public-config";
import { activePack } from "@/packs";
import { AnswerChips } from "./answer-chips";
import { AvatarPanel } from "./avatar-panel";
import { Composer } from "./composer";
import { deviceSteps, MAX_AUTO_CAPTURES, type CaptureStatus, type Refusal } from "./device-steps";
import { Bubble, Message } from "./message";
import { RestartNotice } from "./restart-notice";
import { ServiceChips } from "./service-chips";
import { StepOverlay } from "./step-overlay";
import { TurnFailed } from "./turn-failed";
import { speakableText, useKioskChat } from "./use-chat";
import { useChatVoice } from "./use-chat-voice";
import { MicButton, micStatusText } from "./voice-controls";
import styles from "./chat-kiosk.module.css";

/** Hold the kiosk's own next move until it has finished speaking; the citizen's answer interrupts. */
const waitForSpeech = () => publicBoolean("NEXT_PUBLIC_KIOSK_WAIT_FOR_SPEECH", true);

const RECAPTURE_MS = 3_000;

const REFUSAL_HOLD_SECONDS = 3;

/** Language every session starts in; spoken turns may switch it — see use-chat-voice. */
const defaultLanguage = () =>
  publicEnv("NEXT_PUBLIC_KIOSK_LANG") ?? activePack().locale.language;

export function ChatKiosk() {
  const chat = useKioskChat();
  const { pendingAsks, busy } = chat;
  const health = useServiceHealth();

  const [started, setStarted] = useState(false);
  /** A first message the visitor implied by scanning at the welcome screen. */
  const seed = useRef<string | null>(null);

  // Lives here rather than in Composer so a dictated turn can be dropped in for review.
  const [draft, setDraft] = useState("");

  // The language this citizen speaks, adopted from their recognized utterances.
  const [language, setLanguage] = useState(defaultLanguage);

  const restartToWelcome = () => {
    setTries({});
    setRefusal(null);
    chat.reset();
    setDraft("");
    setLanguage(defaultLanguage());
    setEnded(false);
    setMapHeld(false);
    setResumedAt(-1);
    setStarted(false);
    followLatest.current = true;
    setAwayFromLatest(false);
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

  // "Something else" carries on past a finished request; only a flow that ends after it ends the chat again.
  const [resumedAt, setResumedAt] = useState(-1);
  const lastFlowAt = chat.messages.findLastIndex((m) => m.parts.some((part) => part.type === "data-flow"));
  // Busy with what the citizen sent. A reply still being written after its steps arrived is not:
  // nothing is in flight that a card tapped now could get ahead of.
  const processing = busy && lastFlowAt !== chat.messages.length - 1;
  const finished =
    !busy &&
    pendingAsks.length === 0 &&
    lastFlowAt > resumedAt &&
    (chat.flow?.status === "completed" || chat.flow?.status === "failed");

  // Latched, so a reply still trickling in behind the receipt cannot reopen the kiosk.
  const [ended, setEnded] = useState(false);
  if (finished && !ended) setEnded(true);
  // The finished request's wipe was held by a tap on its route map — see holdForMap.
  const [mapHeld, setMapHeld] = useState(false);
  // Signed in for this visit: the next service skips the card (see FlowResponse.signIn).
  const signedIn = chat.messages.some((m) =>
    m.parts.some((part) => part.type === "data-flow" && Boolean((part.data as { signIn?: unknown }).signIn)),
  );
  const anotherService = () => {
    setResumedAt(chat.messages.length - 1);
    setEnded(false);
    setMapHeld(false);
    followLatest.current = true;
  };
  // Checked in with a bill still due: paying it is the rest of the visit, one tap away.
  const bill = useService("bill");
  const checkedIn =
    ended && chat.flow?.serviceId === "checkin" && chat.flow.status === "completed" && chat.flow.receipt?.status !== "on_hold"
      ? chat.flow.citizen?.documentNumber
      : undefined;

  const scrollRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileAskId, setFileAskId] = useState<string | null>(null);

  const followLatest = useRef(true);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const showLatest = () => {
    followLatest.current = true;
    setAwayFromLatest(false);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "instant" });
  };

  const followScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    followLatest.current = nearBottom;
    setAwayFromLatest(!nearBottom);
  };

  const inlineAsks = pendingAsks.filter((a) => !a.modal);
  const activeTextAsk = inlineAsks.find((a) => a.type === "text" && !picked[a.id]);

  const startService = (id: string, label: string) => {
    followLatest.current = true;
    chat.startService(id, label, language);
  };

  const payBill = () => {
    anotherService();
    startService("bill", "Pay my bill");
  };

  const labelFor = (ask: Ask, value: string) =>
    ask.type === "action" && value === "done"
      ? (deviceSteps()[ask.id]?.receipt ?? "Done at the kiosk")
      : (ask.options?.find((o) => o.value === value)?.label ?? value);

  /** `extra` carries values that answer no ask and must not be echoed into the transcript. */
  const submitRound = (answers: Record<string, string>, extra?: Record<string, string>) => {
    const shown = Object.entries(answers)
      .map(([id, value]) => labelFor(pendingAsks.find((a) => a.id === id)!, value))
      .join(" · ");
    followLatest.current = true;
    chat.sendAnswers({ ...answers, ...extra }, shown, language);
  };

  const pick = (ask: Ask, value: string) => {
    const next = { ...picked, [ask.id]: value };
    setPicked(next);
    if (inlineAsks.length === 1) submitRound(next);
  };

  /** `spokenIn`: a hands-free utterance's own language, ahead of `language` catching up with it. */
  const handleComposer = (text: string, spokenIn = language) => {
    if (busy) return;
    // Words after a finished request carry the conversation on, as "Something else" does.
    if (ended) anotherService();
    followLatest.current = true;
    if (modalAsks.length > 0) setRound({ key: askIds, answers: picked, spoke: true });
    chat.sendText(text, spokenIn, picked);
  };

  useEffect(() => {
    if (!started || !seed.current) return;
    chat.sendText(seed.current, language, {});
    seed.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per seed
  }, [started]);

  // The ref keeps the voice hook off this handler's per-render identity.
  const submitRef = useRef(handleComposer);
  useEffect(() => {
    submitRef.current = handleComposer;
  });

  const voice = useChatVoice({
    messages: chat.messages,
    busy,
    blocked: !started || modalAsks.length > 0,
    language,
    onLanguage: setLanguage,
    onSend: (text, spokenIn) => submitRef.current(text, spokenIn),
    onDraft: (text) => setDraft((current) => (current ? `${current} ${text}` : text)),
  });

  const speaking = voice.playback.speakingId !== null;
  const narrating = waitForSpeech() && speaking;

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

  // A patient still talking to the kiosk after a request is not gone: their question lands before the wipe.
  const restart = useAutoRestart({
    when: ended,
    paused: narrating || voice.input.isSpeaking || voice.input.isTranscribing,
    onRestart: restartToWelcome,
  });

  // A tap on a route map holds the wipe, as on the touch route screen: the countdown is out of
  // sight behind a full-screen map. The idle clock still clears a map someone walked away from.
  const holdForMap = (event: React.PointerEvent) => {
    if (restart.secondsLeft === null || !(event.target as Element).closest("[data-route-card]")) return;
    setMapHeld(true);
    restart.hold();
  };

  // The clock is held while the kiosk is working, speaking, listening or waiting on hardware.
  useIdleRestart({
    enabled: started && (!finished || mapHeld),
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
      language,
    );
  };

  const pickFile = (askId: string) => {
    setFileAskId(askId);
    fileRef.current?.click();
  };

  const autoCapture = documentSource() !== "upload";
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
      documentSource() === "scanner"
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
            (documentSource() === "scanner"
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
    chat.sendUpload(captured, `📄 ${captured.fileName}`, language);
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

  // After every handler that moves followLatest: the compiler freezes a ref once an effect reads it.
  // Keep streaming replies in view without pulling someone out of chat history. Sizes rather than
  // messages, so what lays out after its reply — a route map loading in — still comes into view.
  useEffect(() => {
    const scroller = scrollRef.current;
    const transcript = transcriptRef.current;
    if (!scroller || !transcript) return;
    const observer = new ResizeObserver(() => {
      if (transcript.dataset.empty === "true" || !followLatest.current) return;
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
    });
    observer.observe(transcript);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [started, health.unavailable]);

  if (health.unavailable) {
    return <ServiceUnavailableScreen />;
  }

  if (!started) {
    return (
      <WelcomeScreen
        onBegin={() => setStarted(true)}
        onSignIn={(scanned) => {
          setStarted(true);
          if (scanned === "appointmentSlip") seed.current = "I'd like to check in for my appointment";
        }}
      />
    );
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <KioskBrand />
        <div className="flex items-center gap-2">
          <ModeToggle className="flex size-12 items-center justify-center rounded-xl border transition-colors hover:border-ring" />
          <ThemeToggle className="flex size-12 items-center justify-center rounded-xl border transition-colors hover:border-ring" />
          <button
            onClick={restartToWelcome}
            className="flex min-h-12 items-center gap-2 rounded-xl border px-5 py-2.5 text-base font-semibold text-muted-foreground transition-colors hover:border-ring hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className="size-5" />
            Restart
          </button>
        </div>
      </header>

      {/* React events cross portals, so this also sees taps on the full-screen map. */}
      <main className={styles.workspace} onPointerDownCapture={holdForMap}>
        <div className={styles.layout} data-avatar={voice.avatar.status !== "off"}>
          {voice.avatar.status !== "off" && (
            <AvatarPanel
              className={styles.assistant}
              state={avatarState}
              caption={caption}
              progress={voice.playback.progress}
              stream={voice.avatar.stream}
              status={voice.avatar.status}
            />
          )}

          <section aria-label="Chat with your patient assistant" className={styles.conversation}>
            <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><MessagesSquare className="size-5" aria-hidden /></span>
              <div className="min-w-0">
                <h1 className="text-base font-semibold sm:text-lg">Your patient assistant</h1>
                <p className="truncate text-sm text-muted-foreground" role="status">
                  {ended ? "Request finished" : busy ? "Preparing your reply…" : modalAsks.length ? "Follow the step shown below" : chat.flow?.serviceLabel ?? "Here to help with your hospital visit"}
                </p>
              </div>
            </div>
            <div className="relative min-h-0 flex-1">
              <div
                ref={scrollRef}
                className={`${styles.scroller} h-full overflow-y-auto overscroll-contain`}
                role="region"
                aria-label="Conversation history"
                tabIndex={0}
                onScroll={followScroll}
              >
                <div ref={transcriptRef} className={`${styles.transcript} mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6`} data-empty={chat.messages.length === 0}>
                  {chat.messages.length === 0 ? (
                    <div className="pb-1">
                      <p className="mb-2 text-sm font-medium text-primary">Welcome. Let’s take it one step at a time.</p>
                      <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">How can I help you today?</h2>
                      <p className="mt-2 text-base leading-relaxed text-muted-foreground">Choose a service below or tell me what you need.</p>
                    </div>
                  ) : <Bubble role="bot">How can I help with your hospital visit?</Bubble>}

                  <div role="log" aria-label="Messages" aria-live="polite" aria-busy={busy} className="flex flex-col gap-5 empty:hidden">
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
                  </div>
                  {busy && modalAsks.length === 0 && (
                    <div role="status" className="flex items-center gap-3 text-muted-foreground">
                      <Spinner className="size-5" />
                      <span className="text-base">Working on it…</span>
                    </div>
                  )}

                  {chat.failed && !busy && !ended && modalAsks.length === 0 && (
                    <TurnFailed onRetry={chat.retry} />
                  )}

                  {!busy && inlineAsks.length > 0 && (
                    <AnswerChips
                      asks={inlineAsks}
                      canListen={voice.canListen}
                      picked={picked}
                      activeTextAsk={activeTextAsk}
                      onPick={pick}
                      onContinue={() => submitRound(picked)}
                      onOther={() => composerRef.current?.focus()}
                    />
                  )}

                  {ended && checkedIn && bill && <PayBalanceOffer documentNumber={checkedIn} onPay={payBill} />}

                  {ended && (
                    <RestartNotice
                      secondsLeft={restart.secondsLeft}
                      signedIn={signedIn}
                      onNow={restartToWelcome}
                      onHold={restart.hold}
                      onAnother={anotherService}
                    />
                  )}

                  {!busy && !ended && !chat.failed && pendingAsks.length === 0 && (
                    chat.messages.length === 0 ? (
                      <ServiceChips onStart={startService} />
                    ) : (
                      <details className="rounded-2xl border bg-card p-4" open={resumedAt >= 0 && lastFlowAt <= resumedAt}>
                        <summary className="min-h-12 cursor-pointer content-center font-medium text-primary">Explore hospital services</summary>
                        <ServiceChips onStart={startService} />
                      </details>
                    )
                  )}
                </div>
              </div>

              {awayFromLatest && chat.messages.length > 0 && modalAsks.length === 0 && (
                <button type="button" onClick={showLatest} className="absolute bottom-3 left-1/2 flex min-h-12 -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border bg-card px-5 text-sm font-semibold shadow-lg hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
                  <ArrowDown className="size-4" aria-hidden /> Latest messages
                </button>
              )}
              {modalAsks.length > 0 && (
                <StepOverlay
                  asks={modalAsks}
                  busy={busy}
                  processing={processing}
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
                  onConfirm={(ask, extra) => {
                    // A step done mid-sentence ends the instructions for it.
                    voice.playback.stop();
                    submitRound({ [ask.id]: "done" }, extra);
                  }}
                  onOption={(ask, value) => submitRound({ [ask.id]: value })}
                  onUpload={pickFile}
                />
              )}
            </div>

            <Composer
              inputRef={composerRef}
              busy={busy}
              awaiting={Boolean(activeTextAsk)}
              placeholder={
                ended
                  ? "Anything else? Ask me, or tap Finish when you're done."
                  : activeTextAsk
                    ? (activeTextAsk.placeholder ?? "Type your answer…")
                    : modalAsks.length > 0
                      ? "Ask me about this step…"
                      : "Tell me what you need…"
              }
              value={draft}
              onValueChange={setDraft}
              onSubmit={handleComposer}
              mic={voice.canListen ? <MicButton voice={voice} disabled={busy} /> : null}
              error={voice.input.error}
              status={micStatusText(voice)}
            />
          </section>
        </div>
      </main>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png"
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
