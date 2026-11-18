// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/** Shared flat config for non-Next packages in the monorepo. */
export const baseConfig = defineConfig([
  globalIgnores(['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.turbo/**']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
]);

export default baseConfig;
