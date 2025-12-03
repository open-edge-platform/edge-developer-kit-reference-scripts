// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { KeyboardVoice, Refresh, Send, Stop } from '@mui/icons-material';
import { CircularProgress, IconButton, Stack, TextField, Tooltip } from '@mui/material';
import { Box } from '@mui/system';
import { type ChatRequestOptions, type UIMessage } from 'ai';
import { enqueueSnackbar } from 'notistack';

interface ChatBody {
  modelID?: string;
  max_tokens: number;
  temperature: number;
  conversationCount: number;
  rag: boolean;
  systemPrompt: string | null;
  functionTools: string | null;
}

export default function ChatTextField({
  modelID,
  isError,
  isModelLoading,
  messages,
  input,
  setInput,
  chatBody,
  isGettingResponse,
  setMessages,
  sendMessage,
  handleStop,
  speechProcessing,
  recording,
  startRecording,
  stopRecording,
  clearAudioQueue,
  isPlaying,
}: {
  modelID?: string;
  isError: boolean;
  isModelLoading: boolean;
  messages: UIMessage[];
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  chatBody: ChatBody;
  isGettingResponse: boolean;
  setMessages: (messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])) => void;
  sendMessage(message: UIMessage, options?: ChatRequestOptions): Promise<void>;
  handleStop: VoidFunction;
  recording: boolean;
  speechProcessing: boolean;
  startRecording: VoidFunction;
  stopRecording: VoidFunction;
  clearAudioQueue: VoidFunction;
  isPlaying: boolean;
}): React.JSX.Element {
  const handleRefresh = (): void => {
    setMessages([]);
    setInput('');
  };

  const handleMicClick = (): void => {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleStopChat = (): void => {
    handleStop();
    clearAudioQueue();
  };

  const handleEnter = async (event: React.KeyboardEvent<HTMLDivElement> | undefined): Promise<void> => {
    if (event?.key !== 'Enter' || isGettingResponse || !input?.trim()) {
      return;
    }
    await handleOnSend();
  };

  const handleOnSend = async (): Promise<void> => {
    if (!modelID) {
      enqueueSnackbar('Failed to get the model id from server.', { variant: 'error' });
      return;
    }
    const trimmedInput = input?.trim();
    if (!trimmedInput) {
      return;
    }
    clearAudioQueue();
    await sendMessage(
      {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: trimmedInput }],
      },
      {
        body: chatBody,
      }
    );
    setInput('');
  };

  return (
    <TextField
      fullWidth
      multiline
      rows={3}
      variant="standard"
      placeholder={isGettingResponse ? 'Response generating...' : 'Type your message here'}
      value={input}
      onChange={(event) => {
        setInput(event.target.value);
      }}
      onKeyDown={handleEnter}
      disabled={isGettingResponse}
      InputProps={{
        endAdornment: (
          <Stack direction="row" spacing={1}>
            {isGettingResponse || isPlaying ? (
              <IconButton onClick={handleStopChat} color="error">
                <Tooltip title="Stop Chat" placement="top">
                  <Stop />
                </Tooltip>
              </IconButton>
            ) : (
              messages.length >= 1 && (
                <IconButton onClick={handleRefresh} disabled={isGettingResponse || isPlaying} color="primary">
                  <Tooltip title="Refresh Chat" placement="top">
                    <Refresh />
                  </Tooltip>
                </IconButton>
              )
            )}
            {speechProcessing ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <CircularProgress size={25} />
              </Box>
            ) : (
              <Tooltip title={`${recording ? 'Stop' : 'Start'} Recording`} placement="top">
                <Box>
                  <IconButton
                    onClick={handleMicClick}
                    color="primary"
                    disabled={isPlaying || isGettingResponse || isError || isModelLoading}
                  >
                    {recording ? <Stop color="error" /> : <KeyboardVoice />}
                  </IconButton>
                </Box>
              </Tooltip>
            )}

            <Tooltip title="Submit" placement="top">
              <Box>
                <IconButton
                  type="submit"
                  onClick={handleOnSend}
                  disabled={
                    !input?.trim() ||
                    isPlaying ||
                    isGettingResponse ||
                    isError ||
                    isModelLoading ||
                    recording ||
                    speechProcessing
                  }
                  color="primary"
                >
                  <Send />
                </IconButton>
              </Box>
            </Tooltip>
          </Stack>
        ),
      }}
    />
  );
}
