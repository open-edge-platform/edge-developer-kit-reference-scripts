// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Framework
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownProps {
  content: string;
}

export default function Markdown({ content }: MarkdownProps): React.JSX.Element {
  return (
    <>
      <div
        className="markdown"
        style={{
          maxHeight: '100%',
          maxWidth: '95%',
          overflow: 'auto',
          overflowWrap: 'break-word',
          wordWrap: 'break-word',
          wordBreak: 'break-word',
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
      <style>
        {`
          .markdown code {
            white-space: pre-wrap; /* Ensures code blocks wrap properly */
            word-break: break-word; /* Ensures long words in code blocks break and wrap */
          }
        `}
      </style>
    </>
  );
}
