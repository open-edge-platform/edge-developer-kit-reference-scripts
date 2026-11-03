// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  quickStart: {
    steps: [
      'List the avatar skins with `GET /v1/avatar`; `POST /v1/avatar` makes a new one from a video.',
      "Open a WebRTC session: send the browser's SDP offer to `POST /v1/lipsync/offer`. The answer carries the `session_id`.",
      'Make the avatar speak in that session: `POST /v1/lipsync/chat` with text, or `POST /v1/lipsync` with an audio file.',
    ],
    request: {
      language: 'cURL',
      languageCode: 'bash',
      code: `curl ${host}/v1/avatar`,
    },
  },
  overview:
    'The Lipsync service provides real-time avatar lip-syncing powered by Wav2Lip models. It streams video via WebRTC, supports custom avatar uploads, and integrates with TTS for text-driven lip-sync chat.',
  endpoints: [
    {
      method: 'POST',
      path: '/v1/lipsync/prepare',
      description:
        'Get the avatar a session shows ready before sending the offer. MuseTalk makes an avatar\'s face crops, then the latents encoded from them, the first time it is used (minutes each on the CPU; the worker starts on its default avatar\'s when it starts). Answers Server-Sent "status" events: { status: "preparing", stage: "crops" | "latents", done, total } while it works, then "ready" (at once for Wav2Lip or an avatar prepared before) or "error" with a detail.',
    },
    {
      method: 'POST',
      path: '/v1/lipsync/offer',
      description:
        'Establish a WebRTC peer connection for real-time avatar streaming',
      params: [
        {
          name: 'sdp',
          type: 'string',
          required: true,
          desc: 'Session Description Protocol offer',
        },
        {
          name: 'type',
          type: 'string',
          required: true,
          desc: "SDP type (e.g. 'offer')",
        },
        {
          name: 'turn',
          type: 'boolean',
          required: false,
          desc: 'Whether to use a TURN server for WebRTC relay',
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/lipsync/chat',
      description:
        'Send text to the avatar for lip-synced speech via TTS integration',
      params: [
        {
          name: 'session_id',
          type: 'string',
          required: true,
          desc: 'Active WebRTC session ID',
        },
        {
          name: 'chat_type',
          type: 'string',
          required: true,
          desc: "Chat action: 'echo', 'clear', or 'stop'",
        },
        {
          name: 'text',
          type: 'string',
          required: true,
          desc: 'Text to speak and lip-sync',
        },
        {
          name: 'voice',
          type: 'string',
          required: false,
          desc: 'TTS voice name',
        },
        {
          name: 'model',
          type: 'string',
          required: false,
          desc: 'TTS model name',
        },
        {
          name: 'speed',
          type: 'string',
          required: false,
          desc: 'Speech speed',
        },
        {
          name: 'frame_generation',
          type: 'boolean',
          required: false,
          desc: 'Fill in-between frames with AI interpolation (needs the Frame Generation service; only activates when inference cannot match the avatar frame rate)',
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/lipsync/stop',
      description:
        'Stop the avatar speaking: drops the text and audio still queued, including the rest of the sentence being synthesized',
      params: [
        {
          name: 'session_id',
          type: 'string',
          required: true,
          desc: 'Active WebRTC session ID',
        },
        {
          name: 'chat_type',
          type: 'string',
          required: true,
          desc: "Must be 'stop'",
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/lipsync',
      description: 'Process an audio file for lip-sync streaming via WebRTC',
      params: [
        {
          name: 'file',
          type: 'file (binary)',
          required: true,
          desc: 'Audio file (WAV or MP3)',
        },
        {
          name: 'session_id',
          type: 'string',
          required: true,
          desc: 'Active WebRTC session ID',
        },
        {
          name: 'text_overlay',
          type: 'string',
          required: false,
          desc: 'Text overlay to display during playback',
        },
        {
          name: 'language_code',
          type: 'string',
          required: false,
          desc: "Language code for text overlay (default: 'en-US')",
        },
        {
          name: 'frame_generation',
          type: 'boolean',
          required: false,
          desc: 'Fill in-between frames with AI interpolation (needs the Frame Generation service; only activates when inference cannot match the avatar frame rate)',
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/avatar',
      description:
        'Upload a video to generate a custom avatar skin in the background; answers with the taskId to follow',
      params: [
        {
          name: 'video',
          type: 'file (binary)',
          required: true,
          desc: 'Video file for avatar generation',
        },
        {
          name: 'session_id',
          type: 'string',
          required: false,
          desc: 'WebRTC session ID; not needed to create an avatar',
        },
        {
          name: 'skin_name',
          type: 'string',
          required: false,
          desc: 'Display name for the avatar skin',
        },
      ],
    },
    {
      method: 'GET',
      path: '/v1/tasks/{taskId}',
      description:
        'Poll an avatar generation task (status: processing | finished | error | cancelled | not_found; progress 0-1 of the whole job, stage queued | extracting | detecting | saving | musetalk, and a human-readable message; finished adds avatar_id, error adds detail, and cancel_requested: true is added once the task was cancelled)',
    },
    {
      method: 'GET',
      path: '/v1/tasks/{taskId}/events',
      description:
        'Follow an avatar generation task as Server-Sent Events (text/event-stream): a "status" event carrying the same body as GET /v1/tasks/{taskId} whenever it changes, ending after the finished, error or cancelled status (an unknown task gets an "error" event)',
    },
    {
      method: 'DELETE',
      path: '/v1/tasks/{taskId}',
      description:
        'Cancel an avatar generation task; answers with its status afterwards. Avatar tasks run side by side, each as soon as its upload is accepted: one that has not started yet is "cancelled" at once. A running task keeps "processing" with cancel_requested: true until its next frame (frame extraction, face detection, saving the crops or the MuseTalk crop pass), where it stops, deletes the half-made skin with its uploaded video so it never appears in GET /v1/avatar, and becomes "cancelled"; it is not made the default skin. A finished task is returned unchanged; an unknown one answers 404 { status: "not_found" }.',
    },
    {
      method: 'GET',
      path: '/v1/avatar',
      description: 'List all available avatar skins',
    },
  ],
  sampleCode: [
    {
      title: 'WebRTC Connection',
      codeSnippets: [
        {
          language: 'JavaScript',
          languageCode: 'typescript',
          code: `const pc = new RTCPeerConnection();
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

const response = await fetch("${host}/v1/lipsync/offer", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sdp: offer.sdp, type: offer.type }),
});

const answer = await response.json();
await pc.setRemoteDescription(new RTCSessionDescription(answer));`,
        },
      ],
    },
    {
      title: 'Chat',
      codeSnippets: [
        {
          language: 'Python',
          languageCode: 'python',
          code: `import requests

response = requests.post(
    "${host}/v1/lipsync/chat",
    json={
        "session_id": "abc1",
        "chat_type": "echo",
        "text": "Hello, welcome to the demo!",
        "voice": "af_heart",
    }
)

print(response.json())`,
        },
      ],
    },
  ],
  responseExample: `{
  "sdp": "v=0\\r\\no=- ...",
  "type": "answer",
  "session_id": "abc1"
}`,
})
