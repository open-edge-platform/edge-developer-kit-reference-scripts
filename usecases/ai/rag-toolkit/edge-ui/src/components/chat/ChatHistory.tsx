// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import React, { memo, useCallback, useEffect, useRef } from 'react';
import { Avatar, Box, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { UIMessage } from 'ai';

import Markdown from '../common/markdown';
import AnimatedDots from './AnimatedDots';

interface ChatMessageProps {
  message: UIMessage;
  isLoading?: boolean;
}

const ChatMessage = memo(({ message, isLoading }: ChatMessageProps) => {
  const isUser = message.role === 'user';

  return (
    <Box
      sx={(theme) => ({
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        display: 'flex',
        padding: theme.spacing(2),
      })}
    >
      <Paper
        sx={(theme) => ({
          padding: theme.spacing(2),
          maxWidth: '70%',
          borderRadius: '25px',
          backgroundColor: isUser ? theme.palette.primary.main : theme.palette.grey[300],
          color: isUser ? theme.palette.primary.contrastText : theme.palette.text.primary,
        })}
        elevation={1}
      >
        <Stack direction="row" spacing={2}>
          <Avatar
            sx={{
              mr: 2,
              mt: '.5rem',
              border: '1px solid black',
              bgcolor: isUser ? 'white' : 'secondary.main',
              color: isUser ? 'black' : 'white',
            }}
          >
            {isUser ? 'U' : 'A'}
          </Avatar>
          {isLoading ? (
            <Box sx={{ my: '1.5rem', pt: '.5rem' }}>
              <AnimatedDots />
            </Box>
          ) : (
            <Markdown content={message.parts.map((part, index) => (part.type === 'text' ? part.text : '')).join('')} />
          )}
        </Stack>
      </Paper>
    </Box>
  );
});

ChatMessage.displayName = 'ChatMessage';

interface ChatHistoryProps {
  isLoading: boolean;
  isError: boolean;
  messages: UIMessage[];
  isGettingResponse: boolean;
}

const ChatHistory: React.FC<ChatHistoryProps> = memo(({ isLoading, isError, messages, isGettingResponse }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom, messages.length]);

  if (isError || isLoading) {
    return <ErrorDisplay isLoading={isLoading} />;
  }

  if (messages.length < 1) {
    return <EmptyStateDisplay />;
  }

  return (
    <Box flexGrow={1} overflow="auto" sx={{ border: 1, borderRadius: 2, mt: 2, mb: 2 }}>
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
      {isGettingResponse && messages[messages.length - 1].role !== 'assistant' ? (
        <ChatMessage
          key="ChatMessage_loading"
          message={{
            id: 'loading',
            role: 'assistant',
            parts: [{ type: 'text', text: 'Loading...' }],
          }}
          isLoading
        />
      ) : null}
      <div ref={messagesEndRef} />
    </Box>
  );
});

ChatHistory.displayName = 'ChatHistory';

const ErrorDisplay = memo<{ isLoading: boolean }>(({ isLoading }) => (
  <Stack gap="1rem" height="100%" justifyContent="center" alignItems="center">
    {isLoading ? (
      <>
        <Typography variant="h6">Oops, model failed to be fetched.</Typography>
        <Typography variant="h6">Please refresh the page to try again</Typography>
      </>
    ) : (
      <>
        <Typography variant="h6">Model Loading...</Typography>
        <CircularProgress />
      </>
    )}
  </Stack>
));

ErrorDisplay.displayName = 'ErrorDisplay';

const EmptyStateDisplay = memo(() => (
  <Stack gap="1rem" height="100%" justifyContent="center" alignItems="center">
    <Typography variant="h6">Start by typing some message to me below.</Typography>
  </Stack>
));

EmptyStateDisplay.displayName = 'EmptyStateDisplay';

export default ChatHistory;
