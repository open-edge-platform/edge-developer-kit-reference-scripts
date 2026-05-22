// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  serviceDescription:
    'The Reranker service leverages the OpenVINO Model Server to rescore candidate documents against a query for precise relevance ordering. It exposes a Cohere-compatible rerank endpoint, enabling seamless use with existing Cohere client libraries or direct HTTP calls — without requiring an Internet connection.',
  overview:
    'The service exposes a Cohere-compatible rerank endpoint that accepts a query and a list of candidate documents, returning relevance scores for each pair. Ideal for improving retrieval quality in RAG, search, and recommendation pipelines.',
  endpoints: [
    {
      method: 'POST',
      path: '/v1/rerank',
      description:
        'Rerank a list of documents by relevance to a query. Returns documents sorted by relevance score.',
      params: [
        {
          name: 'model',
          type: 'string',
          required: true,
          desc: 'Name of the model to use. Name assigned to a servable configured to run the reranking model.',
        },
        {
          name: 'query',
          type: 'string',
          required: true,
          desc: 'Text to compare the similarity with the documents.',
        },
        {
          name: 'documents',
          type: 'string[]',
          required: true,
          desc: 'List of document strings to rerank.',
        },
        {
          name: 'top_n',
          type: 'integer',
          required: false,
          desc: 'Limit the response to the N most relevant results.',
        },
        {
          name: 'return_documents',
          type: 'boolean',
          required: false,
          desc: 'Whether to include the document text in the response.',
        },
      ],
    },
  ],
  sampleCodeIntro:
    'The service is compatible with the Cohere rerank API. You can use the Cohere Python client library by pointing the base URL to the service, or make direct HTTP calls.',
  sampleCode: [
    {
      title: 'Rerank',
      codeSnippets: [
        {
          language: 'Python',
          languageCode: 'python',
          code: `import cohere

client = cohere.ClientV2(
    base_url="${host}/rerank/v1",
    api_key="unused",
)

response = client.rerank(
    model="rerank",
    query="What is edge AI computing?",
    documents=[
        "Edge AI processes data locally on devices.",
        "Cloud computing uses remote servers.",
        "OpenVINO optimizes AI models for Intel hardware.",
        "Recipe for chocolate cake."
    ],
    top_n=3,
)
for result in response.results:
    print(f"Index {result.index}: score={result.relevance_score:.4f}")`,
        },
        {
          language: 'JavaScript',
          languageCode: 'javascript',
          code: `const response = await fetch('${host}/rerank/v1/rerank', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'rerank',
    query: 'What is edge AI computing?',
    documents: [
      'Edge AI processes data locally on devices.',
      'Cloud computing uses remote servers.',
      'OpenVINO optimizes AI models for Intel hardware.',
    ],
    top_n: 3,
  }),
})

const data = await response.json()
for (const result of data.results) {
  console.log(\`Index \${result.index}: score=\${result.relevance_score.toFixed(4)}\`)
}`,
        },
        {
          language: 'cURL',
          languageCode: 'bash',
          code: `curl ${host}/rerank/v1/rerank \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "rerank",
    "query": "What is edge AI computing?",
    "documents": ["Edge AI processes data locally.", "Cloud computing overview."],
    "top_n": 2
  }'`,
        },
      ],
    },
  ],
  responseExample: `{
  "results": [
    {
      "index": 0,
      "relevance_score": 0.3886180520057678
    },
    {
      "index": 1,
      "relevance_score": 0.0055549247190356255
    }
  ]
}`,
})
