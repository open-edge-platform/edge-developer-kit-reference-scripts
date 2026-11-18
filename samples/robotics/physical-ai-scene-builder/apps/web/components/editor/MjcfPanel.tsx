// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import type { SceneNode } from '@mujoco-studio/types';
import { Button, Panel, PanelBody, PanelHeader } from '@mujoco-studio/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import { lineAt, locateNodeInMjcf } from '@/lib/editor/mjcfSource';

/** Fixed text metrics so highlight bars line up with textarea lines without measuring. */
const LINE_HEIGHT = 18;
const PADDING_Y = 12;
/** Matches the textarea's `px-4`. */
const PADDING_X = 16;

export interface MjcfPanelProps {
  source: string;
  dirty: boolean;
  onChange: (source: string) => void;
  onCompile: () => void;
  /** Highlighted and scrolled into view; null for no or multiple selection. */
  selectedNode: SceneNode | null;
}

export function MjcfPanel({ source, dirty, onChange, onCompile, selectedNode }: MjcfPanelProps) {
  const { status, error } = usePhysics();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const lines = useMemo(() => {
    const range = selectedNode ? locateNodeInMjcf(source, selectedNode) : null;
    if (!range) return null;
    return {
      start: lineAt(source, range.start),
      tagEnd: lineAt(source, range.tagEnd - 1),
      end: lineAt(source, range.end - 1),
      column: range.start - (source.lastIndexOf('\n', range.start - 1) + 1),
    };
  }, [selectedNode, source]);
  const focusKey = selectedNode?.id ?? null;

  // Bring the selected element into view when the selection changes (not on every keystroke, so
  // typing elsewhere in a draft doesn't yank the scroll position).
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!focusKey) {
      scrolledFor.current = null;
      return;
    }
    if (!textarea || !lines || scrolledFor.current === focusKey) return;
    scrolledFor.current = focusKey;
    const top = PADDING_Y + lines.start * LINE_HEIGHT;
    const bottom = PADDING_Y + (lines.tagEnd + 1) * LINE_HEIGHT;
    if (top < textarea.scrollTop || bottom > textarea.scrollTop + textarea.clientHeight) {
      textarea.scrollTop = Math.max(0, top - textarea.clientHeight / 3);
    }
    // Deeply nested elements start far right: bring the tag's indentation into view.
    const context = document.createElement('canvas').getContext('2d');
    if (context) {
      context.font = getComputedStyle(textarea).font;
      const left = lines.column * context.measureText('0').width;
      const visible = textarea.clientWidth - 2 * PADDING_X;
      if (left < textarea.scrollLeft || left > textarea.scrollLeft + visible * 0.25) {
        textarea.scrollLeft = Math.max(0, left - 2 * PADDING_X);
      }
    }
  }, [focusKey, lines]);

  return (
    <Panel className="w-full flex-1 border-0">
      <PanelHeader
        title="MJCF source"
        actions={
          <Button
            size="sm"
            variant={dirty ? 'primary' : 'outline'}
            disabled={status !== 'ready'}
            onClick={onCompile}
          >
            Compile
          </Button>
        }
      />
      {selectedNode && lines && (
        <div
          className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-4 font-mono text-[10px] text-muted"
          aria-label="Selected element in source"
        >
          <span className="size-1.5 shrink-0 bg-accent" aria-hidden="true" />
          <span className="truncate">
            {selectedNode.kind} <span className="text-foreground">{selectedNode.name}</span>
          </span>
          <span className="ml-auto shrink-0">
            {lines.end > lines.start
              ? `lines ${lines.start + 1}–${lines.end + 1}`
              : `line ${lines.start + 1}`}
          </span>
        </div>
      )}
      <PanelBody className="relative flex flex-col overflow-hidden">
        {lines && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0"
            style={{ transform: `translateY(${PADDING_Y - scrollTop}px)` }}
          >
            <div
              className="absolute inset-x-0 border-l-2 border-accent/30 bg-accent/[0.05]"
              style={{
                top: lines.start * LINE_HEIGHT,
                height: (lines.end - lines.start + 1) * LINE_HEIGHT,
              }}
            />
            <div
              className="absolute inset-x-0 border-l-2 border-accent bg-accent/15"
              style={{
                top: lines.start * LINE_HEIGHT,
                height: (lines.tagEnd - lines.start + 1) * LINE_HEIGHT,
              }}
            />
          </div>
        )}
        <textarea
          ref={textareaRef}
          aria-label="MJCF source"
          value={source}
          spellCheck={false}
          wrap="off"
          onChange={(event) => onChange(event.target.value)}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className="relative min-h-0 flex-1 resize-none overflow-auto bg-transparent px-4 font-mono text-[11px] whitespace-pre text-muted-foreground outline-none"
          style={{
            lineHeight: `${LINE_HEIGHT}px`,
            paddingTop: PADDING_Y,
            paddingBottom: PADDING_Y,
          }}
        />
      </PanelBody>
      {error && (
        <pre className="max-h-40 shrink-0 overflow-auto border-t border-danger/40 bg-danger/10 px-4 py-3 font-mono text-[11px] whitespace-pre-wrap text-danger">
          {error}
        </pre>
      )}
    </Panel>
  );
}
