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
const response = await fetch('http://localhost:${port}/offer', {
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
        async with session.post('http://localhost:${port}/offer', 
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
      code: `
// Send message to avatar
const handleSendMessage = (message) => {
  if (!message) return
  
  // Send message - avatar will speak the message
  fetch('http://localhost:${port}/chat',{
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
  await fetch('http://localhost:${port}/stop'}', {
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
        async with session.post('http://localhost:${port}/chat', 
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
        async with session.post('http://localhost:${port}/chat/stop', 
                               json={"sessionId": session_id}) as resp:
            return await resp.json()`,
    },
  ]

  const fullExampleSnippet: CodeSnippet[] = [
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `import React, { useRef, useEffect, useState } from 'react'
function AvatarChat() {
  const [peerConnection, setPeerConnection] = useState(null)
  const [sessionId, setSessionId] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [currentMessage, setCurrentMessage] = useState('')
  const videoRef = useRef(null)

  const connectAvatar = async () => {
    const config = {
      sdpSemantics: 'unified-plan',
      iceServers: []
    }
    
    const pc = new RTCPeerConnection(config)
    setPeerConnection(pc)
    
    // Handle incoming video stream
    pc.addEventListener('track', (evt) => {
      if (evt.track.kind === 'video') {
        videoRef.current.srcObject = evt.streams[0]
      }
    })
    
    // Add transceivers
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    
    // Create offer and establish connection
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    
    // Wait for ICE gathering
    await new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve()
      } else {
        pc.addEventListener('icegatheringstatechange', () => {
          if (pc.iceGatheringState === 'complete') {
            resolve()
          }
        })
      }
    })
    
    // Connect to avatar service
    setConnectionStatus('connecting')
    try {
      const response = await fetch('http://localhost:${port}/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offer: pc.localDescription })
      })
      
      const answer= await response.json()
      await pc.setRemoteDescription(answer)
      
      setSessionId(session_id)
      setConnectionStatus('connected')
    } catch (error) {
      setConnectionStatus('disconnected')
      console.error('Failed to connect:', error)
    }
  }
  
  // Send message to avatar
  const handleSendMessage = () => {
    if (!currentMessage) return
    
    // Send message - avatar will speak the message
    fetch('http://localhost:${port}/chat',{
        method: 'POST',
        body: JSON.stringify(
        { 
          text: currentMessage, 
          language_code: 'en-US', //Customize your language here for supported tts language
          session_id: sessionId, 
          type: "echo"}
        )
      }
    setCurrentMessage('')
  }

  return (
    <div>
      <video ref={videoRef} autoPlay muted playsInline />
      <button onClick={connectAvatar} disabled={connectionStatus === 'connected'}>
        {connectionStatus === 'connected' ? 'Connected' : 'Connect Avatar'}
      </button>
      
      <div>
        {messages.map((message) => (
          <div key={message.id}>
            <strong>{message.role}:</strong> {message.content}
          </div>
        ))}
      </div>
      
      <input
        value={currentMessage}
        onChange={(e) => setCurrentMessage(e.target.value)}
        placeholder="Type message for avatar to speak..."
        disabled={connectionStatus !== 'connected'}
      />
      <button onClick={handleSendMessage}>Send</button>
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

            <p className="leading-relaxed text-slate-700">
              Once connected, send a POST to the /chat endpoint with type set to
              &quot;echo&quot;, include the session_id from the WebRTC
              handshake, and provide a language_code to select the TTS voice.
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
