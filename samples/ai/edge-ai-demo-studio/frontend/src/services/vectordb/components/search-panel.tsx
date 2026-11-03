// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, Search } from 'lucide-react'
import { TruncatedText } from '@/components/common/truncated-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import type { SearchResult } from '../types'

interface SearchPanelProps {
  query: string
  onQueryChange: (value: string) => void
  onSearch: () => void
  isSearching: boolean
  /** Disables the input/button (e.g. embeddings offline). */
  disabled: boolean
  /** Results of the last search, or undefined if none has run. */
  results?: SearchResult[]
  /** The knowledge base searched, named under the heading. */
  knowledgeBaseName?: string
}

/** "Search Knowledge Base" panel: semantic query input and ranked results. */
export function SearchPanel({
  query,
  onQueryChange,
  onSearch,
  isSearching,
  disabled,
  results,
  knowledgeBaseName,
}: SearchPanelProps) {
  const hasResults = results !== undefined && results.length > 0
  const canSearch = !isSearching && !disabled && query.trim() !== ''

  return (
    <Card className="gap-3.5 py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2.5 text-sm">
          <Search aria-hidden="true" className="text-primary h-4 w-4" />
          Search knowledge base
        </CardTitle>
        {knowledgeBaseName && (
          <p className="text-muted-foreground flex min-w-0 items-baseline gap-1 text-xs">
            <span className="shrink-0">Searches</span>
            <TruncatedText
              text={knowledgeBaseName}
              className="text-foreground max-w-56"
            />
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3 px-5">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Enter search query..."
            aria-label="Search query"
            className="bg-muted/30 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSearch) onSearch()
            }}
          />
          <Button
            onClick={onSearch}
            disabled={!canSearch}
            size="icon"
            className="shrink-0"
            aria-label="Search"
            title="Search"
          >
            {isSearching ? (
              <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Search aria-hidden="true" className="h-4 w-4" />
            )}
          </Button>
        </div>

        {hasResults ? (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium">
              Results ({results.length})
            </p>
            <ul className="max-h-[300px] space-y-2 overflow-auto">
              {results.map((result, i) => (
                <li
                  key={`result-${i}`}
                  data-testid="vectordb-search-result"
                  className="border-border bg-muted/20 space-y-1.5 rounded-lg border p-3"
                >
                  <p className="text-foreground line-clamp-3 text-sm">
                    {result.content}
                  </p>
                  {result.score !== undefined && (
                    <div className="flex items-center gap-2">
                      <Progress
                        value={Math.min(result.score * 100, 100)}
                        aria-label={`Score of result ${i + 1}`}
                        className="h-1.5 flex-1"
                      />
                      <span className="text-muted-foreground font-mono text-xs">
                        {result.score.toFixed(3)}
                      </span>
                    </div>
                  )}
                  {result.metadata &&
                    Object.keys(result.metadata).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(result.metadata).map(([k, v]) => (
                          <Badge
                            key={k}
                            variant="secondary"
                            className="max-w-full text-xs"
                          >
                            {k}: {String(v)}
                          </Badge>
                        ))}
                      </div>
                    )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="border-border text-muted-foreground bg-muted/20 rounded-lg border p-6 text-center text-xs">
            {results !== undefined
              ? 'No matches found for this query.'
              : 'Run a query to see semantic matches.'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
