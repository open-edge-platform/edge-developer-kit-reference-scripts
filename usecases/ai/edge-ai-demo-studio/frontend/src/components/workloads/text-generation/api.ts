// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { EndpointProps } from '../endpoint'

export const textGenerationEndpoints: EndpointProps[] = [
  {
    title: 'OpenVINO Completion API',
    description:
      'Generate text based on a given prompt using OpenVINO Model Server with OpenAI-compatible API.',
    path: '/v3/completions',
    body: `{
    "model": "llama3",
    "prompt": "This is a test",
    "stream": false,
    "max_tokens": 100,
    "temperature": 1.0
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "logprobs": null,
      "text": "You are testing me!"
    }
  ],
  "created": 1716825108,
  "model": "llama3",
  "object": "text_completion",
  "usage": {
    "completion_tokens": 14,
    "prompt_tokens": 17,
    "total_tokens": 31
  }
}`,
    parameters: [
      {
        name: 'model',
        description:
          'Name of the model to use. From administrator point of view it is the name assigned to a MediaPipe graph configured to schedule generation using desired model.',
        required: true,
      },
      {
        name: 'prompt',
        description:
          'The prompt(s) to generate completions for, encoded as a string. Currently only single string prompt is supported.',
        required: true,
      },
      {
        name: 'max_tokens',
        description:
          'The maximum number of tokens that can be generated. If not set, the generation will stop once EOS token is generated.',
        required: false,
      },
      {
        name: 'temperature',
        description:
          'The value is used to modulate token probabilities for multinomial sampling. It enables multinomial sampling when set to > 0.0. Default: 1.0',
        required: false,
      },
      {
        name: 'top_p',
        description:
          'Controls the cumulative probability of the top tokens to consider. Must be in (0, 1]. Set to 1 to consider all tokens. Default: 1.0',
        required: false,
      },
      {
        name: 'top_k',
        description:
          'Controls the number of top tokens to consider. Set to empty or -1 to consider all tokens.',
        required: false,
      },
      {
        name: 'stop',
        description:
          'Up to 4 sequences where the API will stop generating further tokens. Can be a string or array of strings.',
        required: false,
      },
      {
        name: 'stream',
        description:
          'If set to true, partial message deltas will be sent to the client. Default: false',
        required: false,
      },
      {
        name: 'stream_options',
        description:
          'Options for streaming response. Only set this when you set stream: true',
        required: false,
      },
      {
        name: 'n',
        description:
          'Number of output sequences to return for the given prompt. This value must be between 1 <= N <= best_of. Default: 1',
        required: false,
      },
      {
        name: 'best_of',
        description:
          'Number of output sequences that are generated from the prompt. From these best_of sequences, the top n sequences are returned. Default: 1',
        required: false,
      },
      {
        name: 'echo',
        description: 'Echo back the prompt in addition to the completion',
        required: false,
      },
      {
        name: 'logprobs',
        description:
          'Include the log probabilities on the logprob of the returned output token. Only value 1 is accepted. Not returned in stream mode.',
        required: false,
      },
      {
        name: 'frequency_penalty',
        description:
          'Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far. Default: 0.0',
        required: false,
      },
      {
        name: 'presence_penalty',
        description:
          'Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far. Default: 0.0',
        required: false,
      },
      {
        name: 'repetition_penalty',
        description:
          'Penalizes new tokens based on whether they appear in the prompt and the generated text so far. Values > 1.0 encourage new tokens, < 1.0 encourage repetition. Default: 1.0',
        required: false,
      },
      {
        name: 'length_penalty',
        description:
          'Exponential penalty to the length that is used with beam-based generation. Default: 1.0',
        required: false,
      },
      {
        name: 'seed',
        description: 'Random seed to use for the generation. Default: 0',
        required: false,
      },
      {
        name: 'ignore_eos',
        description:
          'Whether to ignore the EOS token and continue generating tokens after the EOS token is generated. Default: false',
        required: false,
      },
      {
        name: 'include_stop_str_in_output',
        description:
          'Whether to include matched stop string in output. Default: false if stream=false, true if stream=true',
        required: false,
      },
      {
        name: 'num_assistant_tokens',
        description:
          'For speculative decoding: how many tokens should a draft model generate before main model validates them. Cannot be used with assistant_confidence_threshold.',
        required: false,
      },
      {
        name: 'assistant_confidence_threshold',
        description:
          'For speculative decoding: confidence level for continuing generation. Cannot be used with num_assistant_tokens.',
        required: false,
      },
      {
        name: 'max_ngram_size',
        description:
          'For prompt lookup decoding: the maximum ngram to use when looking for matches in the prompt.',
        required: false,
      },
    ],
  },
  {
    title: 'OpenVINO Chat Completions API',
    description:
      'Generate conversational responses using OpenVINO Model Server with OpenAI-compatible chat API. Supports both text-only and vision-language models (VLM).',
    path: '/v3/chat/completions',
    body: `{
    "model": "llama3",
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant."
      },
      {
        "role": "user",
        "content": "hello"
      }
    ],
    "stream": false,
    "max_tokens": 100,
    "temperature": 1.0
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "logprobs": null,
      "message": {
        "content": "\\n\\nHow can I help you?",
        "role": "assistant"
      }
    }
  ],
  "created": 1716825108,
  "model": "llama3",
  "object": "chat.completion",
  "usage": {
    "completion_tokens": 38,
    "prompt_tokens": 22,
    "total_tokens": 60
  }
}`,
    parameters: [
      {
        name: 'model',
        description:
          'Name of the model to use. From administrator point of view it is the name assigned to a MediaPipe graph configured to schedule generation using desired model.',
        required: true,
      },
      {
        name: 'messages',
        description:
          'A list of messages comprising the conversation so far. Each object should contain role ("system", "user", or "assistant") and content (text or array for VLM models with images).',
        required: true,
      },
      {
        name: 'max_tokens',
        description:
          'The maximum number of tokens that can be generated. If not set, the generation will stop once EOS token is generated.',
        required: false,
      },
      {
        name: 'temperature',
        description:
          'The value is used to modulate token probabilities for multinomial sampling. It enables multinomial sampling when set to > 0.0. Default: 1.0',
        required: false,
      },
      {
        name: 'top_p',
        description:
          'Controls the cumulative probability of the top tokens to consider. Must be in (0, 1]. Set to 1 to consider all tokens. Default: 1.0',
        required: false,
      },
      {
        name: 'top_k',
        description:
          'Controls the number of top tokens to consider. Set to empty or -1 to consider all tokens.',
        required: false,
      },
      {
        name: 'stop',
        description:
          'Up to 4 sequences where the API will stop generating further tokens. Can be a string or array of strings.',
        required: false,
      },
      {
        name: 'stream',
        description:
          'If set to true, partial message deltas will be sent to the client. Default: false',
        required: false,
      },
      {
        name: 'stream_options',
        description:
          'Options for streaming response. Only set this when you set stream: true',
        required: false,
      },
      {
        name: 'n',
        description:
          'Number of output sequences to return for the given prompt. This value must be between 1 <= N <= best_of. Default: 1',
        required: false,
      },
      {
        name: 'best_of',
        description:
          'Number of output sequences that are generated from the prompt. From these best_of sequences, the top n sequences are returned. Default: 1',
        required: false,
      },
      {
        name: 'logprobs',
        description:
          'Include the log probabilities on the logprob of the returned output token. Not returned in stream mode.',
        required: false,
      },
      {
        name: 'frequency_penalty',
        description:
          'Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far. Default: 0.0',
        required: false,
      },
      {
        name: 'presence_penalty',
        description:
          'Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far. Default: 0.0',
        required: false,
      },
      {
        name: 'repetition_penalty',
        description:
          'Penalizes new tokens based on whether they appear in the prompt and the generated text so far. Values > 1.0 encourage new tokens, < 1.0 encourage repetition. Default: 1.0',
        required: false,
      },
      {
        name: 'length_penalty',
        description:
          'Exponential penalty to the length that is used with beam-based generation. Default: 1.0',
        required: false,
      },
      {
        name: 'seed',
        description: 'Random seed to use for the generation. Default: 0',
        required: false,
      },
      {
        name: 'ignore_eos',
        description:
          'Whether to ignore the EOS token and continue generating tokens after the EOS token is generated. Default: false',
        required: false,
      },
      {
        name: 'include_stop_str_in_output',
        description:
          'Whether to include matched stop string in output. Default: false if stream=false, true if stream=true',
        required: false,
      },
      {
        name: 'tools',
        description:
          'A list of tools the model may call. Currently, only functions are supported as a tool.',
        required: false,
      },
      {
        name: 'tool_choice',
        description:
          'Controls which (if any) tool is called by the model. "none" means no tool calls, "auto" lets model choose.',
        required: false,
      },
      {
        name: 'chat_template_kwargs',
        description:
          'Enables passing additional parameters to chat template engine. Effective only in configuration with Python support.',
        required: false,
      },
      {
        name: 'num_assistant_tokens',
        description:
          'For speculative decoding: how many tokens should a draft model generate before main model validates them. Cannot be used with assistant_confidence_threshold.',
        required: false,
      },
      {
        name: 'assistant_confidence_threshold',
        description:
          'For speculative decoding: confidence level for continuing generation. Cannot be used with num_assistant_tokens.',
        required: false,
      },
      {
        name: 'max_ngram_size',
        description:
          'For prompt lookup decoding: the maximum ngram to use when looking for matches in the prompt.',
        required: false,
      },
    ],
  },
]
