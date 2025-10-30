// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { EndpointProps } from '../endpoint'

export const lipsyncEndpoints: EndpointProps[] = [
  {
    title: 'WebRTC Offer',
    description:
      'Initialize a WebRTC connection with the Lipsync service for real-time video streaming. This establishes the connection for receiving lip-synced avatar video and audio.',
    path: '/v1/lipsync/offer',
    body: `{
  "sdp": "v=0\\r\\no=- 123456789 2 IN IP4 127.0.0.1\\r\\ns=-\\r\\nt=0 0\\r\\na=group:BUNDLE 0 1\\r\\na=extmap-allow-mixed\\r\\na=msid-semantic: WMS\\r\\nm=audio 9 UDP/TLS/RTP/SAVPF 111\\r\\nc=IN IP4 0.0.0.0\\r\\na=rtcp:9 IN IP4 0.0.0.0\\r\\na=ice-ufrag:example\\r\\na=ice-pwd:examplepassword\\r\\na=ice-options:trickle\\r\\na=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99\\r\\na=setup:actpass\\r\\na=mid:0\\r\\na=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level\\r\\na=sendrecv\\r\\na=msid:- audio_track_id\\r\\na=rtcp-mux\\r\\na=rtpmap:111 opus/48000/2\\r\\na=rtcp-fb:111 transport-cc\\r\\na=fmtp:111 minptime=10;useinbandfec=1\\r\\na=ssrc:1111 cname:example\\r\\na=ssrc:1111 msid:- audio_track_id\\r\\nm=video 9 UDP/TLS/RTP/SAVPF 96\\r\\nc=IN IP4 0.0.0.0\\r\\na=rtcp:9 IN IP4 0.0.0.0\\r\\na=ice-ufrag:example\\r\\na=ice-pwd:examplepassword\\r\\na=ice-options:trickle\\r\\na=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99\\r\\na=setup:actpass\\r\\na=mid:1\\r\\na=extmap:14 urn:ietf:params:rtp-hdrext:toffset\\r\\na=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time\\r\\na=extmap:13 urn:3gpp:video-orientation\\r\\na=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01\\r\\na=extmap:12 http://www.webrtc.org/experiments/rtp-hdrext/playout-delay\\r\\na=extmap:11 http://www.webrtc.org/experiments/rtp-hdrext/video-content-type\\r\\na=extmap:7 http://www.webrtc.org/experiments/rtp-hdrext/video-timing\\r\\na=extmap:8 http://www.webrtc.org/experiments/rtp-hdrext/color-space\\r\\na=sendrecv\\r\\na=msid:- video_track_id\\r\\na=rtcp-mux\\r\\na=rtcp-rsize\\r\\na=rtpmap:96 VP8/90000\\r\\na=rtcp-fb:96 goog-remb\\r\\na=rtcp-fb:96 transport-cc\\r\\na=rtcp-fb:96 ccm fir\\r\\na=rtcp-fb:96 nack\\r\\na=rtcp-fb:96 nack pli\\r\\na=ssrc:2222 cname:example\\r\\na=ssrc:2222 msid:- video_track_id\\r\\n",
  "type": "offer",
  "turn": false
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "sdp": "v=0\\r\\no=- 123456789 2 IN IP4 127.0.0.1\\r\\ns=-\\r\\nt=0 0\\r\\na=group:BUNDLE 0 1\\r\\na=extmap-allow-mixed\\r\\na=msid-semantic: WMS\\r\\nm=audio 9 UDP/TLS/RTP/SAVPF 111\\r\\nc=IN IP4 0.0.0.0\\r\\na=rtcp:9 IN IP4 0.0.0.0\\r\\na=ice-ufrag:answer\\r\\na=ice-pwd:answerpassword\\r\\na=ice-options:trickle\\r\\na=fingerprint:sha-256 BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA\\r\\na=setup:active\\r\\na=mid:0\\r\\na=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level\\r\\na=sendrecv\\r\\na=msid:- audio_track_id\\r\\na=rtcp-mux\\r\\na=rtpmap:111 opus/48000/2\\r\\na=rtcp-fb:111 transport-cc\\r\\na=fmtp:111 minptime=10;useinbandfec=1\\r\\na=ssrc:3333 cname:answer\\r\\na=ssrc:3333 msid:- audio_track_id\\r\\nm=video 9 UDP/TLS/RTP/SAVPF 96\\r\\nc=IN IP4 0.0.0.0\\r\\na=rtcp:9 IN IP4 0.0.0.0\\r\\na=ice-ufrag:answer\\r\\na=ice-pwd:answerpassword\\r\\na=ice-options:trickle\\r\\na=fingerprint:sha-256 BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA\\r\\na=setup:active\\r\\na=mid:1\\r\\na=extmap:14 urn:ietf:params:rtp-hdrext:toffset\\r\\na=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time\\r\\na=extmap:13 urn:3gpp:video-orientation\\r\\na=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01\\r\\na=extmap:12 http://www.webrtc.org/experiments/rtp-hdrext/playout-delay\\r\\na=extmap:11 http://www.webrtc.org/experiments/rtp-hdrext/video-content-type\\r\\na=extmap:7 http://www.webrtc.org/experiments/rtp-hdrext/video-timing\\r\\na=extmap:8 http://www.webrtc.org/experiments/rtp-hdrext/color-space\\r\\na=sendrecv\\r\\na=msid:- video_track_id\\r\\na=rtcp-mux\\r\\na=rtcp-rsize\\r\\na=rtpmap:96 H264/90000\\r\\na=rtcp-fb:96 goog-remb\\r\\na=rtcp-fb:96 transport-cc\\r\\na=rtcp-fb:96 ccm fir\\r\\na=rtcp-fb:96 nack\\r\\na=rtcp-fb:96 nack pli\\r\\na=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f\\r\\na=ssrc:4444 cname:answer\\r\\na=ssrc:4444 msid:- video_track_id\\r\\n",
  "type": "answer",
  "session_id": "1234"
}`,
    parameters: [
      {
        name: 'sdp',
        description:
          'Session Description Protocol (SDP) offer from the client for WebRTC connection setup.',
        required: true,
      },
      {
        name: 'type',
        description:
          'The type of SDP message. Should be "offer" for initiating connection.',
        required: true,
      },
      {
        name: 'turn',
        description:
          'Whether to use TURN server for NAT traversal. Default: false.',
        required: false,
      },
    ],
  },
  {
    title: 'Lipsync Audio File',
    description:
      'Upload an audio file to the Lipsync service for direct lip-sync processing. The service generates lip-synced video of an avatar speaking along with the provided audio and streams it via WebRTC.',
    path: '/v1/lipsync',
    method: 'POST',
    headers: `Content-Type: multipart/form-data`,
    formData: [
      'file=@audio_file.wav',
      'session_id=1234',
      'language_code=en-US',
      'text_overlay=Hello World',
    ],
    exampleResponse: `{
  "status": "success",
  "session_id": "1234",
  "audio_info": {
    "filename": "audio_file.wav",
    "duration_seconds": 7.720625,
    "sample_rate": 16000,
    "samples": 123530,
    "has_text_overlay": true
  },
  "message": "Audio processing started, check WebRTC stream for output"
}`,
    parameters: [
      {
        name: 'file',
        description:
          'The audio file to process for lipsync. Supported formats: .wav, .mp3',
        required: true,
      },
      {
        name: 'session_id',
        description: 'The session ID of the active avatar WebRTC connection.',
        required: true,
      },
      {
        name: 'language_code',
        description:
          'The language code for audio processing (e.g., "en-US", "zh-CN", "ja-JP").',
        required: false,
      },
      {
        name: 'text_overlay',
        description:
          'Optional text to display as overlay/subtitles during lipsync playback.',
        required: false,
      },
    ],
  },
  {
    title: 'Lipsync Chat',
    description:
      'Send text messages to the Lipsync service for text-to-speech conversion and lip-sync animation. The service converts text to speech and generates synchronized lip movements, streaming the result via WebRTC.',
    path: '/v1/lipsync/chat',
    body: `{
  "chat_type": "echo",
  "session_id": "1234",
  "text": "Hello! This is a sample text that the avatar will speak with lip synchronization.",
  "language_code": "en"
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "status": "success"
}`,
    parameters: [
      {
        name: 'chat_type',
        description:
          'The type of chat command. Supported values: "echo" (speak text), "clear" (clear chat history), "stop" (stop current response).',
        required: true,
      },
      {
        name: 'session_id',
        description: 'The session ID of the active avatar connection.',
        required: true,
      },
      {
        name: 'text',
        description:
          'The text to be spoken by the avatar (required for "echo" chat_type).',
        required: false,
      },
      {
        name: 'language_code',
        description:
          'The language code for text processing (e.g., "en", "fr", "de").',
        required: false,
      },
    ],
  },
  {
    title: 'Stop Lipsync',
    description:
      'Stop the current Lipsync service processing, including any ongoing speech synthesis or lip-sync animation.',
    path: '/v1/lipsync/stop',
    body: `{
  "chat_type": "stop",
  "session_id": "1234"
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "status": "success"
}`,
    parameters: [
      {
        name: 'chat_type',
        description: 'The type of stop command. Currently supports "stop".',
        required: true,
      },
      {
        name: 'session_id',
        description: 'The session ID of the active avatar connection.',
        required: true,
      },
    ],
  },
]
