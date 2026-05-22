// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  overview:
    'The Lipsync service provides real-time avatar lip-syncing powered by Wav2Lip models. It streams video via WebRTC, supports custom avatar uploads, and integrates with TTS for text-driven lip-sync chat.',
  endpoints: [
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
      ],
    },
    {
      method: 'POST',
      path: '/v1/avatar',
      description: 'Upload a video to generate a custom avatar skin',
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
          required: true,
          desc: 'Active WebRTC session ID',
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
