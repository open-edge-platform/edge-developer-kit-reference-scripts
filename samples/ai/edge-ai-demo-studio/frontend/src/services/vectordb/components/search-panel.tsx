// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader2, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SearchResult } from '../types'
import { PanelCard } from './panel-card'

interface SearchPanelProps {
  query: string
  onQueryChange: (value: string) => void
  onSearch: () => void
  isSearching: boolean
  /** Disables the input/button (e.g. embeddings offline). */
  disabled: boolean
  /** Results of the last search, or undefined if none has run. */
  results?: SearchResult[]
}

/** "Search Knowledge Base" panel: semantic query input and ranked results. */
export function SearchPanel({
  query,
  onQueryChange,
  onSearch,
  isSearching,
  disabled,
  results,
}: SearchPanelProps) {
  const hasResults = results !== undefined && results.length > 0

  return (
    <PanelCard
      icon={Search}
      title="Search Knowledge Base"
      bodyClassName="space-y-3"
    >
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Enter search query..."
          className="bg-muted/30 text-sm"
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
        />
        <Button
          onClick={onSearch}
          disabled={isSearching || !query.trim() || disabled}
          size="icon"
          className="bg-primary hover:bg-primary-light shrink-0 text-white"
          title="Search"
        >
          {isSearching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </Button>
      </div>

      {hasResults ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium">
            Results ({results.length})
          </p>
          <div className="max-h-[300px] space-y-2 overflow-auto">
            {results.map((result, i) => (
              <div
                key={`result-${i}`}
                data-testid="vectordb-search-result"
                className="border-border bg-muted/20 space-y-1.5 rounded-lg border p-3"
              >
                <p className="text-foreground line-clamp-3 text-sm">
                  {result.content}
                </p>
                {result.score !== undefined && (
                  <div className="flex items-center gap-2">
                    <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                      <div
                        className="bg-primary h-full rounded-full"
                        style={{
                          width: `${Math.min(result.score * 100, 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-muted-foreground font-mono text-[10px]">
                      {result.score.toFixed(3)}
                    </span>
                  </div>
                )}
                {result.metadata && Object.keys(result.metadata).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(result.metadata).map(([k, v]) => (
                      <Badge key={k} variant="secondary" className="text-[9px]">
                        {k}: {String(v)}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="border-border text-muted-foreground bg-muted/20 rounded-lg border p-6 text-center text-xs">
          {results !== undefined
            ? 'No matches found for this query.'
            : 'Run a query to see semantic matches.'}
        </div>
      )}
    </PanelCard>
  )
}
