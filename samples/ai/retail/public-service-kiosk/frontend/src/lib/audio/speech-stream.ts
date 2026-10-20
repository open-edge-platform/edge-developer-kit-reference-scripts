// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Live speech recognition on the studio's speech-to-text worker: the
 * microphone streams to the worker's socket as 16 kHz PCM, the worker's own
 * voice activity detection cuts the utterances, and each one comes back as
 * text the moment it is recognized. Nothing is recorded or uploaded here.
 *
 * Two backends, two sockets. The OpenVINO Model Server worker takes raw PCM
 * frames on `/v1/audio/stream` and cuts with Silero VAD; the OEP worker takes
 * OpenAI Realtime-style events on `/v1/realtime`, cuts with its server VAD
 * and reports the language it recognized. The kiosk server says which one
 * answers (`/api/speech/stream`), looked up again for every socket, because
 * the worker's port is only allocated while it runs.
 *
 * A socket is one listening stretch. Pausing (the kiosk speaking or working)
 * drops it with whatever it had half heard; resuming opens a fresh one.
 */

export type StreamTarget = {
  /** The worker socket, query included. */
  url: string;
  protocol: "audio-stream" | "realtime";
  /** Realtime only: the `turn_detection` for the opening `session.update`. */
  turnDetection?: { threshold?: number; silence_duration_ms?: number };
};

export type SpeechStreamHandlers = {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  /** Utterances cut and still being recognized: some, or none. */
  onTranscribing: (active: boolean) => void;
  /** One utterance recognized — "" when nothing was — with the language the
   *  worker heard, when it says. */
  onTranscript: (text: string, language?: string) => void;
  onError: (message: string) => void;
};

export type SpeechStream = {
  /** Stop listening and release the microphone. */
  close: () => void;
  /** Keep the microphone open but stop listening to it. */
  setPaused: (paused: boolean) => void;
  /** Cut the utterance in progress now and have it recognized. */
  finishNow: () => void;
};

const SAMPLE_RATE = 16_000;
/** 100 ms of audio per frame. */
const FRAME_SAMPLES = 1_600;
/** Audio held while a socket connects, so the first word is not lost. */
const MAX_PENDING_FRAMES = 30;
const RECONNECT_MS = 2_000;
/** How long a socket no longer fed may take to deliver what it owes. */
const RETIRE_MS = 20_000;

/** Float samples to int16 frames of FRAME_SAMPLES, posted to the main thread. */
const WORKLET = `
class Pcm16Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(${FRAME_SAMPLES});
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      this.frame[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === this.frame.length) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(${FRAME_SAMPLES});
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm16-capture", Pcm16Capture);
`;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** One protocol's side of a socket. */
type Session = {
  encode: (pcm: ArrayBuffer) => string | ArrayBuffer;
  opening: string[];
  stop: string;
  /** Returns true once the socket has nothing more to say. */
  handle: (raw: string, ws: WebSocket) => boolean;
};

/** One socket, and how many transcripts it still owes. */
type Link = {
  ws: WebSocket;
  session: Session;
  owed: number;
  expiry?: ReturnType<typeof setTimeout>;
};

type SessionEvents = Pick<SpeechStreamHandlers, "onSpeechStart" | "onSpeechEnd" | "onError"> & {
  queued: () => void;
  settled: (text: string, language?: string) => void;
};

/**
 * `/v1/audio/stream`: binary int16 frames in; `speech_start`, `speech_end
 * {queued}`, one `transcript` per queued utterance (empty text when nothing
 * was recognized) or `error`, and `done` after `{"event":"stop"}`.
 */
function audioStreamSession(events: SessionEvents): Session {
  return {
    encode: (pcm) => pcm,
    opening: [],
    stop: JSON.stringify({ event: "stop" }),
    handle: (raw) => {
      const data = JSON.parse(raw) as { type?: string; queued?: boolean; text?: string; message?: string };
      switch (data.type) {
        case "speech_start":
          events.onSpeechStart();
          break;
        case "speech_end":
          events.onSpeechEnd();
          if (data.queued) events.queued();
          break;
        case "transcript":
          events.settled((data.text ?? "").trim());
          break;
        case "error":
          events.onError(data.message ?? "Speech recognition failed.");
          events.settled("");
          break;
        case "done":
          return true;
      }
      return false;
    },
  };
}

/**
 * `/v1/realtime`: base64 PCM in `input_audio_buffer.append` events; server
 * VAD events out. `completed` carries the whole session transcript so far, so
 * only its new suffix is this utterance, and the language of the first one —
 * so it is passed on for the first only. The worker sends no `completed` for
 * an utterance it recognized nothing in, but it handles one message at a
 * time, so an empty `session.update` sent on each commit is answered only
 * once everything committed before it is done. `session.close` flushes and
 * the worker then closes the socket.
 */
function realtimeSession(target: StreamTarget, events: SessionEvents): Session {
  let cumulative = "";
  let reported = false;
  const committed = new Set<string>();
  return {
    encode: (pcm) => JSON.stringify({ type: "input_audio_buffer.append", audio: toBase64(pcm) }),
    opening: target.turnDetection
      ? [JSON.stringify({ type: "session.update", session: { turn_detection: target.turnDetection } })]
      : [],
    stop: JSON.stringify({ type: "session.close" }),
    handle: (raw, ws) => {
      const data = JSON.parse(raw) as {
        type?: string;
        item_id?: string;
        transcript?: string;
        language?: string;
        error?: { message?: string };
      };
      switch (data.type) {
        case "input_audio_buffer.speech_started":
          events.onSpeechStart();
          break;
        case "input_audio_buffer.speech_stopped":
          events.onSpeechEnd();
          break;
        case "input_audio_buffer.committed":
          if (data.item_id) committed.add(data.item_id);
          events.queued();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "session.update", session: {} }));
          }
          break;
        case "conversation.item.input_audio_transcription.completed": {
          const full = (data.transcript ?? "").trim();
          const text = (full.startsWith(cumulative) ? full.slice(cumulative.length) : full).trim();
          cumulative = full;
          if (data.item_id) committed.delete(data.item_id);
          events.settled(text, text && !reported ? data.language : undefined);
          if (text) reported = true;
          break;
        }
        case "transcription_session.updated":
          // Whatever was committed before this answer and got no transcript
          // had nothing in it.
          committed.forEach(() => events.settled(""));
          committed.clear();
          break;
        case "error":
          events.onError(data.error?.message ?? "Speech recognition failed.");
          break;
      }
      return false;
    },
  };
}

/**
 * Opens the microphone and starts listening on `target`; every later socket
 * asks `resolveTarget` again. Rejects when the microphone is unavailable —
 * the caller turns that into a message.
 */
export async function openSpeechStream(
  target: StreamTarget,
  resolveTarget: () => Promise<StreamTarget>,
  handlers: SpeechStreamHandlers,
): Promise<SpeechStream> {
  // The worker's VAD decides on this audio, so it gets the same clean-up the
  // recorder had: in hands-free mode the kiosk's own narration plays from
  // the same enclosure.
  const media = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  // The context runs at the worker's rate and resamples the microphone itself.
  const audio = new AudioContext({ sampleRate: SAMPLE_RATE });
  const moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
  try {
    await audio.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  const source = audio.createMediaStreamSource(media);
  const capture = new AudioWorkletNode(audio, "pcm16-capture");
  // Wired through to the speakers so the graph pulls it; it outputs silence.
  source.connect(capture).connect(audio.destination);

  let closed = false;
  let paused = false;
  let speaking = false;
  let transcribing = false;
  /** The socket the microphone feeds. */
  let current: Link | null = null;
  /** Sockets no longer fed, kept open for the transcripts they still owe. */
  const retiring = new Set<Link>();
  let pending: ArrayBuffer[] = [];
  let reconnect: ReturnType<typeof setTimeout> | null = null;

  const live = () => !closed && !paused;

  const reportTranscribing = () => {
    let owed = current?.owed ?? 0;
    for (const link of retiring) owed += link.owed;
    if (transcribing === owed > 0) return;
    transcribing = owed > 0;
    handlers.onTranscribing(transcribing);
  };

  const endSpeaking = () => {
    if (!speaking) return;
    speaking = false;
    handlers.onSpeechEnd();
  };

  const shut = (link: Link) => {
    retiring.delete(link);
    if (current === link) current = null;
    clearTimeout(link.expiry);
    link.owed = 0;
    link.ws.onclose = null;
    link.ws.onmessage = null;
    link.ws.close();
    reportTranscribing();
  };

  /** Stop feeding a socket. An utterance it was still hearing is never cut,
   *  so it is dropped; the ones it already cut are still delivered. */
  const retire = (link: Link) => {
    if (current === link) current = null;
    endSpeaking();
    if (link.owed === 0) {
      shut(link);
      return;
    }
    retiring.add(link);
    link.expiry = setTimeout(() => shut(link), RETIRE_MS);
  };

  const retryLater = () => {
    reconnect = setTimeout(() => {
      reconnect = null;
      connect();
    }, RECONNECT_MS);
  };

  const openSocket = (to: StreamTarget) => {
    if (!live() || current) return;
    const ws = new WebSocket(to.url);
    ws.binaryType = "arraybuffer";
    const events: SessionEvents = {
      onSpeechStart: () => {
        if (current !== link || speaking) return;
        speaking = true;
        handlers.onSpeechStart();
      },
      onSpeechEnd: () => {
        if (current === link) endSpeaking();
      },
      onError: handlers.onError,
      queued: () => {
        link.owed += 1;
        reportTranscribing();
      },
      settled: (text, language) => {
        link.owed = Math.max(0, link.owed - 1);
        reportTranscribing();
        handlers.onTranscript(text, language);
        if (retiring.has(link) && link.owed === 0) shut(link);
      },
    };
    const link: Link = {
      ws,
      session: to.protocol === "realtime" ? realtimeSession(to, events) : audioStreamSession(events),
      owed: 0,
    };
    current = link;

    ws.onopen = () => {
      for (const message of link.session.opening) ws.send(message);
      if (current !== link) return;
      for (const frame of pending) ws.send(link.session.encode(frame));
      pending = [];
    };
    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let over = false;
      try {
        over = link.session.handle(event.data, ws);
      } catch {
        return;
      }
      if (over) shut(link);
    };
    ws.onclose = () => {
      const fed = current === link;
      shut(link);
      if (!fed) return;
      endSpeaking();
      if (!live()) return;
      handlers.onError("The speech service stopped responding.");
      retryLater();
    };
  };

  const connect = async () => {
    if (!live() || current) return;
    try {
      openSocket(await resolveTarget());
    } catch (error) {
      if (!live()) return;
      handlers.onError(error instanceof Error ? error.message : "Speech recognition is unavailable.");
      retryLater();
    }
  };

  capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    if (!live()) return;
    if (current && current.ws.readyState === WebSocket.OPEN) {
      current.ws.send(current.session.encode(event.data));
    } else {
      // Still connecting: hold the audio so the first word is not lost.
      pending.push(event.data);
      if (pending.length > MAX_PENDING_FRAMES) pending.shift();
    }
  };

  openSocket(target);

  return {
    close: () => {
      if (closed) return;
      closed = true;
      if (reconnect) clearTimeout(reconnect);
      for (const link of [...retiring]) shut(link);
      if (current) shut(current);
      endSpeaking();
      capture.port.onmessage = null;
      source.disconnect();
      capture.disconnect();
      audio.close();
      for (const track of media.getTracks()) track.stop();
    },
    setPaused: (next) => {
      if (paused === next || closed) return;
      paused = next;
      if (paused) {
        if (reconnect) clearTimeout(reconnect);
        reconnect = null;
        pending = [];
        if (current) retire(current);
      } else {
        connect();
      }
    },
    finishNow: () => {
      const link = current;
      if (!live() || !link || link.ws.readyState !== WebSocket.OPEN) return;
      link.ws.send(link.session.stop);
      // The flush is answered with the utterance in progress, even one the
      // worker's VAD never heard start; the socket closes once it has.
      link.owed += 1;
      reportTranscribing();
      retire(link);
      connect();
    },
  };
}
