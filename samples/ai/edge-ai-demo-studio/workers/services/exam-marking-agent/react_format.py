# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Shared ReAct prompt header and output parser for the exam marking agents.

LlamaIndex's default ReAct header seeds every turn with "I need to use a tool to
help me answer the question", which pushes the model into calling tools (or a
made-up "None" tool) even for small talk. This header keeps the ReAct
Thought/Action/Observation/Answer loop but leaves the decision of whether a tool
is needed to the model's own reasoning.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Iterable

from llama_index.core.agent.react.formatter import ReActChatFormatter
from llama_index.core.agent.react.output_parser import ReActOutputParser
from llama_index.core.agent.react.types import (
    BaseReasoningStep,
    ResponseReasoningStep,
)
from llama_index.core.tools import FunctionTool

REACT_SYSTEM_HEADER = """\
You are an AI agent. You think step by step about what the user wants and decide \
for yourself how best to respond.

{context}

## Tools

You can use the following tools:
{tool_desc}

Tools are optional. For every user message, first reason about what the user is \
actually asking and whether responding well requires information you do not have \
yet. Call a tool only when its result is needed; otherwise respond directly.

## Output Format

Please answer in the same language as the question and use the following format:

```
Thought: The current language of the user is: (user's language). (Your reasoning about what the user wants and whether a tool is needed.)
Action: tool name (one of {tool_names}) if using a tool.
Action Input: the input to the tool, in a JSON format representing the kwargs (e.g. {{"student_id": "12345"}})
```

Please ALWAYS start with a Thought.

NEVER surround your response with markdown code markers. You may use code markers within your response if you need to.

Please use a valid JSON format for the Action Input. If you include the "Action:" line, then you MUST include the "Action Input:" line too, even if the tool does not need kwargs, in that case you MUST use "Action Input: {{}}".

If this format is used, the tool will respond in the following format:

```
Observation: tool response
```

You should keep repeating the above format till you have enough information to answer the question. If no tool is needed at all, skip the Action lines and answer right away. When you are ready to answer, you MUST respond in the following format:

```
Thought: I can answer without using any more tools. I'll use the user's language to answer
Answer: [your answer here (In the same language as the user's question; use a markdown bullet list if it has several points)]
```

Rules:
- Never write "Action: None" or name anything that is not one of the listed tools.
- Never write an Answer in the same response as an Action, and never write an Observation yourself.
- Only state facts about students, scores, or results that come from tool observations; never invent data.

## Current Conversation

Below is the current conversation consisting of interleaving human and assistant messages.
"""

# Pseudo tool names models emit when they decide no tool is needed.
_NO_TOOL_ACTIONS = {
    "",
    "-",
    "n/a",
    "na",
    "no",
    "no tool",
    "no_tool",
    "none",
    "nothing",
    "null",
}

_ACTION_LINE = re.compile(r"^\s*Action:[ \t]*(.*)$", re.MULTILINE)
_ACTION_INPUT_LINE = re.compile(r"^\s*Action Input:.*$", re.MULTILINE)
_OBSERVATION_LINE = re.compile(r"^\s*Observation:.*$", re.MULTILINE)
_LANGUAGE_PREAMBLE = re.compile(
    r"^\s*The current language of the user is:?[^.\n]*\.?\s*", re.IGNORECASE
)


class TolerantReActOutputParser(ReActOutputParser):
    """ReAct parser for models that write a pseudo action ("Action: None") when
    no tool is needed. Instead of executing a non-existent tool or retrying
    (which makes the model answer again), the reply is taken as the answer.

    A reply with only a Thought (no Action, no Answer) — typically the model
    deciding to ask the user for clarification — is also taken as the answer.
    The base parser rejects it, and the retry makes the model repeat the same
    Thought until the iteration limit is hit."""

    def parse(self, output: str, is_streaming: bool = False) -> BaseReasoningStep:
        action = _ACTION_LINE.search(output)
        if action is None and "Answer:" not in output and "Thought:" in output:
            thought = output.split("Thought:", 1)[1].strip()
            answer = _LANGUAGE_PREAMBLE.sub("", thought, count=1).strip()
            if answer:
                return ResponseReasoningStep(
                    thought=thought, response=answer, is_streaming=is_streaming
                )

        name = (
            action.group(1).strip().strip("`'\"*").strip().lower() if action else None
        )
        if name is None or name not in _NO_TOOL_ACTIONS:
            return super().parse(output, is_streaming=is_streaming)

        thought = output[: action.start()].split("Thought:", 1)[-1].strip()
        if "Answer:" in output:
            answer = output.split("Answer:", 1)[1].strip()
        else:
            # "Action: None" followed by an unlabelled reply.
            rest = _ACTION_INPUT_LINE.sub("", output[action.end() :])
            answer = _OBSERVATION_LINE.sub("", rest).strip()
            if not answer or "Thought:" in answer:
                # Surfaced to the model as a retry message by the ReAct agent.
                raise ValueError(
                    f"'Action: {action.group(1).strip()}' is not a tool. If no tool "
                    "is needed, do not write an Action line at all; reply with "
                    "'Thought: ...' followed by 'Answer: ...'."
                )
        return ResponseReasoningStep(
            thought=thought or "No tool is needed.",
            response=answer,
            is_streaming=is_streaming,
        )


def guarded_tools(fns: Iterable[Callable[..., Any]]) -> list[FunctionTool]:
    """Wrap plain tool functions for a single agent run.

    Small models tend to loop: after a tool error (e.g. an argument the tool
    does not accept) or even after a successful result they repeat the exact
    same Thought/Action. Each wrapped tool therefore
    - reports unknown arguments together with the valid ones, and
    - refuses an identical repeat call, telling the model to use the earlier
      observation, try something different, or answer.

    Build a fresh list per request: the repeat tracking is per run.
    """
    seen: set[tuple[str, str]] = set()
    tools = []
    for fn in fns:
        base = FunctionTool.from_defaults(fn=fn)
        name = base.metadata.get_name()
        params = set(base.metadata.get_parameters_dict().get("properties", {}))
        tools.append(
            FunctionTool(
                fn=_guard(fn, name, params, seen),
                metadata=base.metadata,
            )
        )
    return tools


def _guard(
    fn: Callable[..., Any], name: str, params: set[str], seen: set[tuple[str, str]]
) -> Callable[..., Any]:
    def call(**kwargs: Any) -> Any:
        unknown = sorted(set(kwargs) - params)
        if unknown:
            valid = ", ".join(sorted(params)) or "none (use {})"
            return (
                f"Error: {name} does not accept {', '.join(unknown)}. "
                f"Valid arguments: {valid}."
            )

        normalized = {
            k: v.strip().lower() if isinstance(v, str) else v for k, v in kwargs.items()
        }
        key = (name, json.dumps(normalized, sort_keys=True, default=str))
        if key in seen:
            return (
                f"You already called {name} with these arguments; its result is "
                "in an earlier Observation. Do not call it again. Use that result "
                "to answer, or call a different tool if you still need more data."
            )
        seen.add(key)
        return fn(**kwargs)

    return call


def react_agent_kwargs(system_prompt: str) -> dict:
    """Keyword arguments to pass to ``ReActAgent`` for the shared ReAct format."""
    return {
        "system_prompt": system_prompt,
        "formatter": ReActChatFormatter.from_defaults(
            system_header=REACT_SYSTEM_HEADER, context=system_prompt
        ),
        "output_parser": TolerantReActOutputParser(),
    }
