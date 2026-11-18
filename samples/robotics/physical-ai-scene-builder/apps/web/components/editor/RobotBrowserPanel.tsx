// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { Bot, Plus, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Button, Panel, PanelBody, PanelHeader } from '@mujoco-studio/ui';

import { listRobots, type RobotSummary } from '@/lib/scenes/api';

const ROBOT_TAGS = ['all', 'so101', 'desktop-arm', 'fixed-base'] as const;
type RobotTag = (typeof ROBOT_TAGS)[number];

export function RobotBrowserPanel({
  onAddToScene,
}: {
  onAddToScene: (robot: RobotSummary) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState<RobotTag>('all');
  const deferredSearch = useDeferredValue(search.trim());
  const addToScene = useMutation({
    mutationFn: (robot: RobotSummary) => onAddToScene(robot),
  });
  const robots = useInfiniteQuery({
    queryKey: ['robots', deferredSearch, tag],
    queryFn: ({ pageParam }) =>
      listRobots({ page: pageParam, search: deferredSearch, tag: tag === 'all' ? '' : tag }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasNextPage ? lastPage.nextPage : undefined),
    retry: false,
  });
  const robotList = robots.data?.pages.flatMap((page) => page.docs) ?? [];

  return (
    <Panel className="min-h-0 w-72 flex-1 shrink-0 border-r border-border">
      <PanelHeader title="Robots" />
      <PanelBody className="p-3">
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search robots"
              aria-label="Search robots"
              className="h-8 w-full border border-border bg-surface-raised py-1 pl-8 pr-2 text-xs text-foreground outline-none placeholder:text-muted focus:border-accent"
            />
          </div>
          <label className="block text-[11px] text-muted">
            Filter tag
            <select
              value={tag}
              onChange={(event) => setTag(event.target.value as RobotTag)}
              className="mt-1 h-8 w-full border border-border bg-surface-raised px-2 text-xs text-foreground outline-none focus:border-accent"
            >
              {ROBOT_TAGS.map((value) => (
                <option key={value} value={value}>
                  {value === 'all' ? 'All tags' : value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 space-y-2">
          {robots.isLoading && <p className="text-xs text-muted">Loading robots…</p>}
          {robots.isError && <p className="text-xs text-danger">{robots.error.message}</p>}
          {!robots.isLoading && !robots.isError && robotList.length === 0 && (
            <div className="border border-dashed border-border px-3 py-8 text-center">
              <Bot className="mx-auto size-5 text-muted" />
              <p className="mt-3 text-xs text-muted-foreground">No robots found.</p>
            </div>
          )}
          {robotList.map((robot) => (
            <article key={robot.id} className="border border-border bg-surface-raised p-3">
              <div className="flex items-start gap-2">
                <div className="flex size-9 shrink-0 items-center justify-center border border-border bg-surface text-accent">
                  <Bot className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-xs font-medium text-foreground">{robot.name}</h2>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    {robot.manufacturer ?? 'Unknown manufacturer'}
                  </p>
                </div>
              </div>
              {robot.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {robot.tags
                    .filter((value) => value !== 'seed:so101')
                    .map((value) => (
                      <span
                        key={value}
                        className="border border-border px-1.5 py-0.5 text-[10px] text-muted"
                      >
                        {value}
                      </span>
                    ))}
                </div>
              )}
              <Button
                className="mt-3 w-full"
                size="sm"
                variant="primary"
                disabled={addToScene.isPending}
                onClick={() => addToScene.mutate(robot)}
              >
                <Plus />
                {addToScene.isPending && addToScene.variables?.id === robot.id
                  ? 'Adding robot'
                  : 'Add to scene'}
              </Button>
              {addToScene.isError && addToScene.variables?.id === robot.id && (
                <p className="mt-2 text-[11px] text-danger">{addToScene.error.message}</p>
              )}
            </article>
          ))}
          {robots.hasNextPage && (
            <Button
              className="w-full"
              disabled={robots.isFetchingNextPage}
              onClick={() => robots.fetchNextPage()}
            >
              {robots.isFetchingNextPage ? 'Loading robots' : 'Load more'}
            </Button>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
