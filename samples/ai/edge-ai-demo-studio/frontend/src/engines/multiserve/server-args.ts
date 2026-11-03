// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { splitCommandLine } from '@/lib/command-line'
import type { BackendId } from './types'

/**
 * Extra arguments an instance's model server starts with (`metadata.serverArgs`): llama-server
 * flags, which replace the engine's own, or `ovms --pull` graph options, which the engine applies
 * on every start. The engine refuses the same reserved flags (`modules/extra_args.py`).
 */

const LLAMACPP_RESERVED = new Set([
  '--host',
  '--port',
  '--model',
  '--model-url',
  '--hf-repo',
  '--hf-file',
  '--hf-repo-draft',
  '--hf-token',
  '--docker-repo',
  '--api-key',
  '--api-key-file',
  '--ssl-key-file',
  '--ssl-cert-file',
])

const LLAMACPP_ALIASES: Record<string, string> = {
  '-m': '--model',
  '-mu': '--model-url',
  '-hf': '--hf-repo',
  '-hfr': '--hf-repo',
  '-hff': '--hf-file',
  '-hfd': '--hf-repo-draft',
  '-hft': '--hf-token',
  '-dr': '--docker-repo',
}

const OVMS_RESERVED = new Set([
  '--pull',
  '--source_model',
  '--model_repository_path',
  '--task',
  '--target_device',
  '--model_name',
  '--model_path',
  '--config_path',
  '--overwrite_models',
  '--gguf_filename',
  '--port',
  '--rest_port',
  '--grpc_bind_address',
  '--rest_bind_address',
  '--add_to_config',
  '--remove_from_config',
  '--list_models',
  '--log_level',
  '--log_path',
  '--api_key_file',
])

/** A token's flag as the engine names it; `undefined` for a value (`-1` included). */
function flagName(token: string, backend: BackendId): string | undefined {
  if (!token.startsWith('-') || token.length < 2) return undefined
  if (!Number.isNaN(Number(token))) return undefined
  const name = token.split('=', 1)[0]
  if (backend === 'openvino') return name
  // llama.cpp reads `--reasoning_format` as `--reasoning-format`.
  const dashed = name.startsWith('--') ? name.replace(/_/g, '-') : name
  return LLAMACPP_ALIASES[dashed] ?? dashed
}

export type ParsedServerArgs =
  { ok: true; args: string[] } | { ok: false; error: string }

/** The arguments of `text` for `backend`, or why the engine would refuse them. */
export function parseServerArgs(
  text: string,
  backend: BackendId,
): ParsedServerArgs {
  const split = splitCommandLine(text)
  if (!split.ok) return split
  const { args } = split
  if (args.length > 0 && flagName(args[0], backend) === undefined) {
    return { ok: false, error: `Start with a flag, not "${args[0]}"` }
  }
  const reserved = backend === 'llamacpp' ? LLAMACPP_RESERVED : OVMS_RESERVED
  // Named as typed (`-m`, not `--model`).
  const owned = [
    ...new Set(
      args
        .filter((token) => reserved.has(flagName(token, backend) ?? ''))
        .map((token) => token.split('=', 1)[0]),
    ),
  ]
  if (owned.length > 0) {
    return {
      ok: false,
      error: `${owned.join(', ')} ${owned.length === 1 ? 'is' : 'are'} set by the engine`,
    }
  }
  return { ok: true, args }
}

/** One argument the reference list offers. */
export interface ServerArgHint {
  flag: string
  /** An example value; absent for a switch. */
  value?: string
  description: string
}

/** What the server does with the model, which decides the arguments it takes. */
export type ServerArgTask = 'text-generation' | 'embeddings' | 'rerank'

const LLAMACPP_COMMON: ServerArgHint[] = [
  {
    flag: '-c',
    value: '8192',
    description: "Context size in tokens. Default: the model's, at most 32768.",
  },
  {
    flag: '-ngl',
    value: '99',
    description: 'Layers offloaded to the GPU. Default: all that fit.',
  },
  {
    flag: '-t',
    value: '8',
    description: 'CPU threads for inference.',
  },
  {
    flag: '--no-mmap',
    description: 'Read the whole model into memory instead of mapping it.',
  },
]

const LLAMACPP_HINTS: Record<ServerArgTask, ServerArgHint[]> = {
  'text-generation': [
    ...LLAMACPP_COMMON,
    {
      flag: '-np',
      value: '2',
      description: 'Parallel request slots; they share the context.',
    },
    {
      flag: '-fa',
      value: 'off',
      description: 'Flash attention: on (default), off or auto.',
    },
    {
      flag: '-ctk',
      value: 'q8_0',
      description: 'KV cache type for keys (f16, q8_0, q4_0); -ctv for values.',
    },
    {
      flag: '--chat-template-kwargs',
      value: '\'{"enable_thinking": false}\'',
      description: 'Chat template variables as JSON.',
    },
    {
      flag: '--reasoning-budget',
      value: '0',
      description: 'Thinking tokens: -1 unlimited (default), 0 none.',
    },
    {
      flag: '--reasoning-format',
      value: 'none',
      description:
        'deepseek (default) returns thinking apart; none leaves it in the text.',
    },
  ],
  embeddings: [
    ...LLAMACPP_COMMON,
    {
      flag: '-ub',
      value: '2048',
      description: 'Physical batch size; must hold the longest input.',
    },
    {
      flag: '--pooling',
      value: 'mean',
      description: "none, mean, cls or last. Default: the model's.",
    },
  ],
  rerank: [
    ...LLAMACPP_COMMON,
    {
      flag: '-ub',
      value: '2048',
      description: 'Physical batch size; must hold the longest pair.',
    },
  ],
}

const OVMS_STREAMS: ServerArgHint = {
  flag: '--num_streams',
  value: '2',
  description: 'Parallel inference streams (default 1).',
}

const OVMS_HINTS: Record<ServerArgTask, ServerArgHint[]> = {
  'text-generation': [
    {
      flag: '--max_num_seqs',
      value: '8',
      description: 'Sequences processed together (default 256).',
    },
    {
      flag: '--cache_size',
      value: '2',
      description: 'KV cache size in GB. Default 0: grows as needed.',
    },
    {
      flag: '--kv_cache_precision',
      value: 'u8',
      description: 'u8 lowers the KV cache memory.',
    },
    {
      flag: '--enable_prefix_caching',
      value: 'false',
      description:
        'Reuse the cache of repeated prompt prefixes (default true).',
    },
    {
      flag: '--max_num_batched_tokens',
      value: '2048',
      description: 'Tokens batched together in one step.',
    },
    {
      flag: '--max_prompt_len',
      value: '4096',
      description: 'NPU only: the longest prompt, in tokens.',
    },
    {
      flag: '--reasoning_parser',
      value: 'qwen3',
      description: 'Returns the reasoning apart from the answer.',
    },
    {
      flag: '--tool_parser',
      value: 'hermes3',
      description: 'Parses tool calls (e.g. hermes3, qwen3coder, llama3).',
    },
    {
      flag: '--enable_tool_guided_generation',
      value: 'true',
      description: 'Holds tool calls to their schema; needs a tool parser.',
    },
    {
      flag: '--plugin_config',
      value: '\'{"PERFORMANCE_HINT": "LATENCY"}\'',
      description: 'OpenVINO device properties as JSON.',
    },
  ],
  embeddings: [
    OVMS_STREAMS,
    {
      flag: '--pooling',
      value: 'MEAN',
      description: "CLS, LAST or MEAN. Default: the model's.",
    },
    {
      flag: '--normalize',
      value: 'false',
      description: 'Normalize the embeddings (default true).',
    },
    {
      flag: '--truncate',
      value: 'true',
      description: 'Cut inputs longer than the context (default false).',
    },
  ],
  rerank: [
    OVMS_STREAMS,
    {
      flag: '--max_allowed_chunks',
      value: '1000',
      description: 'Most document chunks per request (default 10000).',
    },
  ],
}

/** The arguments to suggest for `backend` serving `task` (a multimodal model takes text generation's). */
export function serverArgHints(
  backend: BackendId,
  task: ServerArgTask,
): ServerArgHint[] {
  return (backend === 'llamacpp' ? LLAMACPP_HINTS : OVMS_HINTS)[task]
}

/** The task a multiserve service type serves, for {@link serverArgHints}. */
export function serverArgTask(serviceType: string): ServerArgTask {
  return serviceType === 'embeddings' || serviceType === 'rerank'
    ? serviceType
    : 'text-generation'
}

/** `text` with `hint` appended, as one more argument. */
export function appendServerArg(text: string, hint: ServerArgHint): string {
  const arg = hint.value ? `${hint.flag} ${hint.value}` : hint.flag
  const trimmed = text.trimEnd()
  return trimmed ? `${trimmed} ${arg}` : arg
}
