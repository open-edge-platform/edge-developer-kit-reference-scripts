// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import React, { useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { Stack } from '@mui/material';
import { DefaultChatTransport } from 'ai';
import { enqueueSnackbar } from 'notistack';

import { useGetModelID } from '@/hooks/api-hooks/use-chat-api';
import useAudioPlayer from '@/hooks/use-audio-player';
import { useRecordAudio } from '@/hooks/use-record-audio';

import ChatHistory from './ChatHistory';
import ChatTextField from './ChatTextField';
import ChatToolbar from './ChatToolbar';

export default function ChatContainer(): React.JSX.Element {
  const [maxTokens, setMaxTokens] = useState(512);
  const [temperature, setTemperature] = useState(0.3);
  const [rag, setRag] = useState(false);
  const [enableAudio, setEnableAudio] = useState(true);
  const enableAudioRef = React.useRef(enableAudio);
  const [conversationCount, setConversationCount] = useState(0);
  const { data: modelID, isError, isLoading: isModelLoading } = useGetModelID();
  const {
    recording,
    speechProcessing,
    text,
    startRecording,
    stopRecording,
    clearText,
    languages,
    updateLanguage,
    language,
  } = useRecordAudio();
  const { addQueue, clearAudioQueue, isPlaying } = useAudioPlayer();
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [functionTools, setFunctionTools] = useState<string | null>(null);

  useEffect(() => {
    const storedPrompt = localStorage.getItem('systemPrompt');
    if (storedPrompt) {
      setSystemPrompt(storedPrompt);
    }
  }, []);

  useEffect(() => {
    const storedTools = localStorage.getItem('functionTools');
    if (storedTools) {
      setFunctionTools(storedTools);
    }
  }, []);

  useEffect(() => {
    enableAudioRef.current = enableAudio;
  }, [enableAudio]);

  const [input, setInput] = useState('');
  const { messages, setMessages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
    }),
    onFinish: ({ message, messages, isAbort, isDisconnect, isError }) => {
      if (isError || isDisconnect || isAbort) {
        return;
      }

      if (message && enableAudioRef.current) {
        const streamData = message.parts.map((part) => {
          if (part.type === 'text') return { message: part.text, processed: false };
        });
        streamData.forEach((d) => {
          if (d && !d.processed) {
            d.processed = true;
            addQueue(d.message.trim());
          }
        });
      }
    },
    onError: (error) => {
      console.error('An error occurred:', error);
    },
    onData: (data) => {
      console.log('Received data part from server:', data);
    },
  });
  const chatBody = React.useMemo(
    () => ({
      modelID,
      max_tokens: maxTokens,
      temperature,
      conversationCount,
      rag,
      systemPrompt,
      functionTools,
    }),
    [modelID, maxTokens, temperature, conversationCount, rag, systemPrompt, functionTools]
  );

  const updateMaxTokens = (num: number): void => {
    setMaxTokens(num);
  };

  const updateTemperature = (temp: number): void => {
    setTemperature(temp);
  };

  const updateConversationCount = (count: number): void => {
    setConversationCount(count);
  };

  // Update messages once stt is done processing audio
  useEffect(() => {
    const record = async () => {
      if (!recording && !speechProcessing && text.type !== 'none') {
        if (text.type === 'success') {
          if (text.result) {
            await sendMessage(
              { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: text.result }] },
              {
                body: chatBody,
              }
            );
          } else {
            enqueueSnackbar('No text detected', { variant: 'warning' });
          }
        } else {
          enqueueSnackbar(text.result ?? 'Error communicating with server', { variant: 'error' });
        }
        clearText();
      }
    };
    record();
  }, [recording, text, speechProcessing]);

  useEffect(() => {
    clearAudioQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clean up audio queue before starting
  }, []);

  const updateAudio = (): void => {
    setEnableAudio((prev) => !prev);
  };

  const updateRag = (): void => {
    setRag((prev) => !prev);
  };

  return (
    <Stack display="flex" flexDirection="column" height="max(85vh, 450px)" sx={{ justifyContent: 'center' }}>
      <ChatHistory
        isError={isError}
        isLoading={isModelLoading}
        messages={messages}
        isGettingResponse={status === 'streaming'}
      />
      <Stack sx={{ border: '1px solid black', p: '.5rem', pb: 0, borderRadius: '10px', mb: '1rem' }}>
        <ChatToolbar
          conversationCount={conversationCount}
          updateConversationCount={updateConversationCount}
          rag={rag}
          updateRag={updateRag}
          temperature={temperature}
          updateTemperature={updateTemperature}
          language={language}
          languages={languages}
          updateLanguage={updateLanguage}
          enableAudio={enableAudio}
          updateAudio={updateAudio}
          maxTokens={maxTokens}
          updateMaxTokens={updateMaxTokens}
        />
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="center">
          <ChatTextField
            modelID={modelID}
            isError={isError}
            isModelLoading={isModelLoading}
            isGettingResponse={status === 'streaming'}
            messages={messages}
            setMessages={setMessages}
            sendMessage={sendMessage}
            input={input}
            setInput={setInput}
            chatBody={chatBody}
            handleStop={stop}
            recording={recording}
            speechProcessing={speechProcessing}
            isPlaying={isPlaying}
            startRecording={startRecording}
            stopRecording={stopRecording}
            clearAudioQueue={clearAudioQueue}
          />
        </Stack>
      </Stack>
    </Stack>
  );
}
