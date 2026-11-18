// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { cn } from '@mujoco-studio/ui';
import { ChevronDown } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';

import { useEditorStore } from '@/lib/store/editorStore';

const key = (group: string, id: string) => `${group}:${id}`;

/** The one open section of an accordion group, or null; the first stored open id wins. */
function useOpenSection(group: string, ids: readonly string[]): string | null {
  return useEditorStore(
    (state) => ids.find((id) => state.expanded[key(group, id)] ?? false) ?? null,
  );
}

/**
 * A collapsible panel section in a group where at most one section is open; opening one closes
 * the others. Shared by the Generate and Simulate panels so both behave and look the same.
 */
export function AccordionSection({
  group,
  ids,
  sectionId,
  title,
  aside,
  children,
}: {
  /** Store key prefix of the group, for example `simulation` or `generate`. */
  group: string;
  /** Every section id in the group. */
  ids: readonly string[];
  sectionId: string;
  title: string;
  /** Right-aligned header content: a badge or a one-line summary. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const setExpanded = useEditorStore((state) => state.setExpanded);
  const open = useOpenSection(group, ids) === sectionId;
  const generatedId = useId();
  const contentId = `${group}-${sectionId}-${generatedId.replaceAll(':', '')}`;
  const sectionRef = useRef<HTMLElement>(null);

  return (
    <section ref={sectionRef} className="border-b border-border">
      <h3 className="flex items-center pr-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => {
            const nextOpen = !open;
            setExpanded(
              ids.map((id) => key(group, id)),
              false,
            );
            if (nextOpen) {
              setExpanded([key(group, sectionId)], true);
              requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: 'nearest' }));
            }
          }}
          className="flex min-h-10 flex-1 items-center gap-2 pl-6 pr-3 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-muted outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
          <span>{title}</span>
        </button>
        {aside}
      </h3>
      <div id={contentId} hidden={!open} aria-hidden={!open}>
        {children}
      </div>
    </section>
  );
}
