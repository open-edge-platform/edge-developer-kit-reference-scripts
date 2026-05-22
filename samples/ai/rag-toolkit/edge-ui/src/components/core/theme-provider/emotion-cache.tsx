// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import * as React from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import createCache from '@emotion/cache';
import type { EmotionCache, Options as OptionsOfCreateCache } from '@emotion/cache';
import { CacheProvider as DefaultCacheProvider } from '@emotion/react';

interface Registry {
  cache: EmotionCache;
  flush: () => { name: string; isGlobal: boolean }[];
}

export interface NextAppDirEmotionCacheProviderProps {
  options: Omit<OptionsOfCreateCache, 'insertionPoint'>;
  CacheProvider?: (props: { value: EmotionCache; children: React.ReactNode }) => React.JSX.Element | null;
  children: React.ReactNode;
}

// Adapted from https://github.com/garronej/tss-react/blob/main/src/next/appDir.tsx
export default function NextAppDirEmotionCacheProvider(props: NextAppDirEmotionCacheProviderProps): React.JSX.Element {
  const { options, CacheProvider = DefaultCacheProvider, children } = props;

  const [registry] = React.useState<Registry>(() => {
    const cache = createCache(options);
    cache.compat = true;
    const prevInsert = cache.insert;
    let inserted: { name: string; isGlobal: boolean }[] = [];
    cache.insert = (...args) => {
      const [selector, serialized] = args;

      if (cache.inserted[serialized.name] === undefined) {
        inserted.push({ name: serialized.name, isGlobal: !selector });
      }

      return prevInsert(...args);
    };
    const flush = (): { name: string; isGlobal: boolean }[] => {
      const prevInserted = inserted;
      inserted = [];
      return prevInserted;
    };
    return { cache, flush };
  });

  useServerInsertedHTML((): React.JSX.Element | null => {
    const inserted = registry.flush();

    if (inserted.length === 0) {
      return null;
    }

    let styles = '';
    let dataEmotionAttribute = registry.cache.key;

    const globals: { name: string; style: string }[] = [];


    // SECURITY: The use of dangerouslySetInnerHTML here is considered safe because:
    // 1. Emotion generates CSS from static code, not user input.
    // 2. We ensure only string CSS is injected, not objects or unexpected types.
    // 3. For extra defense-in-depth, we sanitize the CSS to strip <script> tags.
    // If you ever allow user input to affect styles, you must sanitize more strictly.
    function sanitizeCSS(css: string): string {
      // Remove <script>...</script> tags as a basic precaution
      return css.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
    }

    inserted.forEach(({ name, isGlobal }: { name: string; isGlobal: boolean }) => {
      const style = registry.cache.inserted[name];
      if (typeof style === 'string') {
        const safeStyle = sanitizeCSS(style);
        if (isGlobal) {
          globals.push({ name, style: safeStyle });
        } else {
          styles += safeStyle;
          dataEmotionAttribute += ` ${name}`;
        }
      }
    });

    // The use of dangerouslySetInnerHTML is required for Emotion SSR hydration.
    // See: https://emotion.sh/docs/ssr and Next.js + Emotion integration docs.
    return (
      <React.Fragment>
        {globals.map(
          ({ name, style }): React.JSX.Element => (
            <style
              // Emotion-generated CSS only; not user input.
              dangerouslySetInnerHTML={{ __html: style }}
              data-emotion={`${registry.cache.key}-global ${name}`}
              key={name}
            />
          )
        )}
        {styles ? (
          <style
            // Emotion-generated CSS only; not user input.
            dangerouslySetInnerHTML={{ __html: styles }}
            data-emotion={dataEmotionAttribute}
          />
        ) : null}
      </React.Fragment>
    );
  });

  return <CacheProvider value={registry.cache}>{children}</CacheProvider>;
}
