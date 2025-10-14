// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import CodeBlock, { CodeSnippet } from '@/components/common/codeblock'

export default function LipsyncDocumentation({ port }: { port: number }) {
  const turnConfigurationSnippet: CodeSnippet[] = [
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `// WebRTC configuration with TURN server for production deployment
const config = {
  sdpSemantics: 'unified-plan',
  iceServers: [
    {
      urls: 'turn:YOUR_SERVER_IP:5901',
      username: 'your-turn-username',  // Optional, if authentication is enabled
      credential: 'your-turn-password'  // Optional, if authentication is enabled
    },
    {
      urls: 'stun:stun.l.google.com:19302'  // Fallback STUN server
    }
  ]
}

const peerConnection = new RTCPeerConnection(config)`,
    },
    {
      language: 'Python',
      languageCode: 'py',
      code: `from aiortc import RTCPeerConnection, RTCIceServer

# Configure TURN server for production deployment
ice_servers = [
    RTCIceServer(
        urls="turn:YOUR_SERVER_IP:5901",
        username="your-turn-username",  # Optional
        credential="your-turn-password"  # Optional
    ),
    RTCIceServer(urls="stun:stun.l.google.com:19302")  # Fallback STUN
]

# Initialize WebRTC connection with TURN server
pc = RTCPeerConnection(
    configuration=RTCConfiguration(iceServers=ice_servers)
)`,
    },
  ]

  const webRTCConnectionSnippet: CodeSnippet[] = [
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `// Initialize WebRTC connection
const config = {
  sdpSemantics: 'unified-plan',
  iceServers: []
}

const peerConnection = new RTCPeerConnection(config)

// Add transceivers for receiving video and audio
peerConnection.addTransceiver('video', { direction: 'recvonly' })
peerConnection.addTransceiver('audio', { direction: 'recvonly' })

// Handle incoming media streams
peerConnection.addEventListener('track', (evt) => {
  if (evt.track.kind == 'video') {
    videoElement.srcObject = evt.streams[0]
  }
})

// Create and send offer to avatar service
const offer = await peerConnection.createOffer()
await peerConnection.setLocalDescription(offer)

// Wait for ICE gathering to complete
await new Promise((resolve) => {
  if (peerConnection.iceGatheringState === 'complete') {
    resolve()
  } else {
    peerConnection.addEventListener('icegatheringstatechange', () => {
      if (peerConnection.iceGatheringState === 'complete') {
        resolve()
      }
    })
  }
})

// Send offer to avatar service and get answer
const response = await fetch('http://localhost:${port}/v1/lipsync/offer', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ offer: peerConnection.localDescription })
})
const offer = await response.json()

// Set remote description to complete connection
await peerConnection.setRemoteDescription(offer)`,
    },
    {
      language: 'Python',
      languageCode: 'py',
      code: `import asyncio
import json
import aiohttp
from aiortc import RTCPeerConnection, RTCSessionDescription

async def connect_to_avatar():
    # Initialize WebRTC connection
    pc = RTCPeerConnection()
    
    # Add transceivers for receiving media
    pc.addTransceiver("video", direction="recvonly")
    pc.addTransceiver("audio", direction="recvonly")
    
    # Handle incoming media streams
    @pc.on("track")
    def on_track(track):
        print(f"Received {track.kind} track")
        # Handle video/audio track as needed
        
    # Create offer
    offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    
    # Send offer to avatar service
    async with aiohttp.ClientSession() as session:
        async with session.post('http://localhost:${port}/v1/lipsync/offer', 
                               json={"offer": pc.localDescription.dict()}) as resp:
            data = await resp.json()
            answer = RTCSessionDescription(**data["answer"])
            session_id = data["session_id"]
    
    # Set remote description
    await pc.setRemoteDescription(answer)
    
    return pc, session_id`,
    },
  ]

  const chatIntegrationSnippet: CodeSnippet[] = [
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `// Send message to avatar
const handleSendMessage = (message) => {
  if (!message) return
  
  // Send message - avatar will speak the message
  fetch('http://localhost:${port}/v1/lipsync/chat',{
      method: 'POST',
      body: JSON.stringify(
      { 
        text: message, 
        language_code: 'en-US', //Customize your language here for supported tts language
        session_id: sessionId, 
        type: "echo"}
      )
    }
}

// Stop avatar speaking
const stopAvatar = async (sessionId) => {
  await fetch('http://localhost:${port}/v1/lipsync/stop'}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId })
  })
}`,
    },
    {
      language: 'Python',
      languageCode: 'py',
      code: `import aiohttp
import asyncio

async def send_message_to_avatar(session_id, message):
    """Send a message to the avatar for speech synthesis"""
    async with aiohttp.ClientSession() as session:
        async with session.post('http://localhost:${port}/v1/lipsync/chat', 
                               json={
                                   "messages": [
                                       {"role": "user", "content": message}
                                   ],
                                   "session_id": session_id
                                   "language_code": "en-US"
                                   "type": "echo"
                               }) as resp:
            # Response will be streamed as the avatar speaks
            async for line in resp.content:
                if line:
                    # Process streaming response
                    yield line.decode()

async def stop_avatar_speaking(session_id):
    """Stop the avatar from speaking"""
    async with aiohttp.ClientSession() as session:
        async with session.post('http://localhost:${port}/v1/lipsync/stop', 
                               json={"sessionId": session_id}) as resp:
            return await resp.json()`,
    },
  ]

  const audioIntegrationSnippet: CodeSnippet[] = [
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `// Upload audio file for lipsync processing
const handleAudioUpload = async (audioFile, sessionId, textOverlay = null) => {
  if (!audioFile || !sessionId) return
  
  const formData = new FormData()
  formData.append('file', audioFile)
  formData.append('session_id', sessionId)
  
  if (textOverlay) {
    formData.append('text_overlay', textOverlay)
  }
  formData.append('language_code', 'en-US')

  try {
    const response = await fetch('http://localhost:${port}/v1/lipsync', {
      method: 'POST',
      body: formData // No need to set Content-Type, browser handles it for FormData
    })
    
    const result = await response.json()
    
    if (result.status === 'success') {
      console.log('Audio processing started:', result.audio_info)
      // Audio will now be processed and lip-synced video will stream via WebRTC
    }
  } catch (error) {
    console.error('Error uploading audio:', error)
  }
}

// Example usage with file input
const fileInput = document.getElementById('audioFile')
fileInput.addEventListener('change', (event) => {
  const file = event.target.files[0]
  const textOverlay = 'This is the transcribed text from the audio'
  
  if (file) {
    handleAudioUpload(file, sessionId, textOverlay)
  }
})`,
    },
    {
      language: 'Python',
      languageCode: 'py',
      code: `import aiohttp
import aiofiles

async def upload_audio_for_lipsync(session_id, audio_file_path, text_overlay=None):
    """Upload audio file for direct lipsync processing"""
    
    # Prepare form data
    data = aiohttp.FormData()
    data.add_field('session_id', session_id)
    data.add_field('language_code', 'en-US')
    
    if text_overlay:
        data.add_field('text_overlay', text_overlay)
    
    # Add audio file
    async with aiofiles.open(audio_file_path, 'rb') as f:
        file_content = await f.read()
        data.add_field('file', file_content, 
                      filename='audio.wav', 
                      content_type='audio/wav')
    
    # Send request
    async with aiohttp.ClientSession() as session:
        async with session.post('http://localhost:${port}/v1/lipsync', 
                               data=data) as resp:
            result = await resp.json()
            
            if result['status'] == 'success':
                print(f"Audio processing started: {result['audio_info']}")
                # Lip-synced video will now stream via WebRTC
                return result
            else:
                raise Exception(f"Failed to process audio: {result}")

# Example usage
async def process_audio_file():
    session_id = "your_session_id_from_webrtc"
    audio_path = "path/to/your/audio/file.wav"
    text_overlay = "This text will appear on the video"
    
    result = await upload_audio_for_lipsync(session_id, audio_path, text_overlay)
    print("Processing result:", result)`,
    },
  ]

  const fullExampleSnippet: CodeSnippet[] = [
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `import React, { useRef, useState } from 'react'

function AvatarChat() {
  const [sessionId, setSessionId] = useState('')
  const [connected, setConnected] = useState(false)
  const [message, setMessage] = useState('')
  const videoRef = useRef(null)
  const audioRef = useRef(null)

  const connect = async () => {
    const pc = new RTCPeerConnection({ sdpSemantics: 'unified-plan', iceServers: [] })
    
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    
    pc.addEventListener('track', (evt) => {
      if (evt.track.kind === 'video') videoRef.current.srcObject = evt.streams[0]
      if (evt.track.kind === 'audio') audioRef.current.srcObject = evt.streams[0]
    })
    
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    
    await new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') resolve()
      else pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') resolve()
      })
    })
    
    const response = await fetch('http://localhost:${port}/v1/lipsync/offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: pc.localDescription.sdp, type: pc.localDescription.type })
    })
    const answer = await response.json()
    
    await pc.setRemoteDescription(new RTCSessionDescription({ sdp: answer.sdp, type: answer.type }))
    setSessionId(answer.session_id)
    setConnected(true)
  }

  const sendMessage = async () => {
    await fetch('http://localhost:${port}/v1/lipsync/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_type: 'echo',
        session_id: sessionId,
        text: message,
        voice: 'af_heart',
        model: 'kokoro',
        speed: '1.0'
      })
    })
    setMessage('')
  }

  const uploadAudio = async (event) => {
    const file = event.target.files[0]
    if (!file) return
    
    const formData = new FormData()
    formData.append('file', file)
    formData.append('session_id', sessionId)
    formData.append('language_code', 'en-US')
    
    await fetch('http://localhost:${port}/v1/lipsync', { method: 'POST', body: formData })
  }

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ marginBottom: '20px' }}>
        <video ref={videoRef} autoPlay muted playsInline style={{ 
          width: '400px', 
          border: '2px solid #ddd',
          borderRadius: '8px'
        }} />
        <audio ref={audioRef} autoPlay style={{ display: 'none' }} />
      </div>
      
      <div style={{ marginBottom: '20px' }}>
        <button onClick={connect} disabled={connected} style={{ 
          padding: '5px 10px',
          marginRight: '10px',
          backgroundColor: connected ? '#28a745' : '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: connected ? 'default' : 'pointer'
        }}>
          {connected ? 'Connected' : 'Connect'}
        </button>
        <span>Session: {sessionId}</span>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <input 
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type message..."
          disabled={!connected}
          style={{ 
            width: '300px', 
            padding: '5px', 
            marginRight: '10px',
            border: '2px solid #ddd',
            borderRadius: '6px'
          }}
        />
        <button onClick={sendMessage} disabled={!connected || !message} style={{
          padding: '5px 10px',
          backgroundColor: '#28a745',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: (!connected || !message) ? 'default' : 'pointer'
        }}>Send</button>
      </div>

      <div>
        <input type="file" accept=".wav,.mp3,.m4a" onChange={uploadAudio} disabled={!connected} style={{
          padding: '5px 10px',
          border: '2px solid #ddd',
          borderRadius: '6px'
        }} />
      </div>
    </div>
  )
}

export default AvatarChat`,
    },
  ]

  return (
    <div className="grid gap-8 lg:grid-cols-4">
      {/* Main Documentation Content */}
      <div className="lg:col-span-4">
        <div className="space-y-8">
          {/* Header */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-slate-900">
                  Avatar Lipsync API
                </h1>
              </div>
            </div>
          </div>

          <div id="overview" className="prose flex max-w-none flex-col gap-4">
            {/* Avatar Lipsync */}
            <p className="leading-relaxed text-slate-700">
              The Avatar Lipsync service provides real-time, AI-powered avatars
              that combine synchronized lip movements with text-to-speech. It
              produces lifelike facial animations and high-quality synthesized
              audio by leveraging modern machine-learning models for natural
              motion and speech.
            </p>
            <p className="leading-relaxed text-slate-700">
              The service uses&nbsp;
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API"
              >
                WebRTC technology
              </a>
              &nbsp;to stream real-time video of the avatar directly to your
              application, ensuring low-latency communication. It integrates
              seamlessly with chat interfaces, allowing users to have natural
              conversations with AI-powered avatars that respond both textually
              and visually.
            </p>
            <p className="leading-relaxed text-slate-700">
              <strong>Network Configuration:</strong> When running locally, ICE
              or TURN servers are not required as the connection is established
              directly. However, when deploying to a server environment or when
              clients need to connect through firewalls/NATs, you will need to
              configure a TURN server for proper WebRTC connectivity.
            </p>

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              TURN Server Setup for Production
            </p>
            <p className="leading-relaxed text-slate-700">
              In production, use a TURN server to relay WebRTC traffic when a
              direct peer-to-peer path is blocked. coturn is a popular,
              open-source TURN implementation that works well for this purpose.
            </p>
            <p className="leading-relaxed text-slate-700">
              For detailed TURN server setup instructions, please refer to
              the&nbsp;
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://github.com/coturn/coturn/wiki/turnserver"
              >
                coturn documentation
              </a>
              &nbsp;or follow this&nbsp;
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://gabrieltanner.org/blog/turn-server/"
              >
                step-by-step guide
              </a>
              &nbsp;for Ubuntu installation.
            </p>
            <p className="leading-relaxed text-slate-700">
              Once your TURN server is running, configure your WebRTC connection
              to use it:
            </p>
            <CodeBlock
              title={'WebRTC Configuration with TURN Server'}
              data={turnConfigurationSnippet}
            />
            <p className="leading-relaxed text-slate-700">
              Replace the placeholders YOUR_SERVER_IP and YOUR_PUBLIC_IP in the
              examples above with your actual server addresses. The example port
              (5901) should match the port configured in your TURN server setup.
              Authentication credentials are optional but recommended in
              production.
            </p>

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Basic WebRTC Connection
            </p>
            <p className="leading-relaxed text-slate-700">
              Here&apos;s how to establish a WebRTC connection with the avatar
              service:
            </p>
            <CodeBlock
              title={'Connect to Avatar via WebRTC'}
              data={webRTCConnectionSnippet}
            />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Audio File Integration with Avatar
            </p>
            <p className="leading-relaxed text-slate-700">
              You can upload audio files directly for lipsync processing without
              requiring text-to-speech conversion. The avatar will lip-sync to
              your uploaded audio and stream the result via WebRTC.
            </p>
            <CodeBlock
              title={'Audio File Integration with Avatar'}
              data={audioIntegrationSnippet}
            />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Chat Integration with Avatar
            </p>
            <p className="leading-relaxed text-slate-700">
              Alternatively, you can send text messages to the avatar which will
              be converted to speech using text-to-speech, then lip-synced and
              streamed via WebRTC. Send a POST to the /v1/lipsync/chat endpoint
              with type set to &quot;echo&quot;, include the session_id from the
              WebRTC handshake, and provide a language_code to select the TTS
              voice.
            </p>
            <CodeBlock
              title={'Chat Integration with Avatar'}
              data={chatIntegrationSnippet}
            />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Complete Avatar Chat Implementation
            </p>
            <p className="leading-relaxed text-slate-700">
              Below is a complete React example that connects to the avatar
              service and implements an interactive chat UI.
            </p>
            <CodeBlock
              title={'Full Avatar Chat Component'}
              data={fullExampleSnippet}
            />

            <p className="leading-relaxed text-slate-700">
              Please refer to the&nbsp;
              <span className="text-primary font-medium">Endpoints</span> tab
              for detailed API specifications and parameter descriptions.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
