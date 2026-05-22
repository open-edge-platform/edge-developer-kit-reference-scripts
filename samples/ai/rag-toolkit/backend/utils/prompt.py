# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

RAG_PROMPT = """Your task is to answer user question based on the provided CONTEXT. DO NOT USE YOUR OWN KNOWLEDGE TO ANSWER THE QUESTION.
If the QUESTION is out of CONTEXT, STRICTLY do not reply.

### TONE
Always reply in a gentle and helpful tone using English like a human.

### CONTEXT
{context}

### QUESTION
{question}
"""

NO_CONTEXT_FOUND_PROMPT = """You are a helpful and truthful assistant. Remind user that you do not have the data related to the question asked and mentioned to user what is the context available.

### TONE
Always reply in a gentle and helpful tone using English like a human.

### QUESTION
{question}
"""

QUERY_REWRITE_PROMPT = """You are a helpful assistant that generates multiple search queries based on a single input query.
Generate 5 search queries related to: {query}
"""