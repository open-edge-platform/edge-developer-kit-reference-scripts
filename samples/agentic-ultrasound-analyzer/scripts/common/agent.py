# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Tool-using agent powered by report generation LLM.

Implements a simple ReAct-style loop:
  1. LLM receives user request + tool descriptions
  2. LLM outputs a JSON tool call  OR  a final answer
  3. Tool is executed, result fed back to LLM
  4. Loop until final answer or max iterations

Designed for small models — uses structured JSON output with explicit
examples rather than relying on native function-calling support.
"""

import json
import re
import time
from typing import Any, Callable

from common.metrics import metrics


# ── Tool Registry ────────────────────────────────────────────────

class Tool:
    """A callable tool the agent can invoke."""

    def __init__(self, name: str, description: str, parameters: dict[str, str],
                 func: Callable[..., Any]):
        self.name = name
        self.description = description
        self.parameters = parameters  # { param_name: description }
        self.func = func

    def run(self, **kwargs) -> str:
        """Execute the tool and return a string result."""
        try:
            result = self.func(**kwargs)
            return json.dumps(result, default=str) if not isinstance(result, str) else result
        except Exception as e:
            return json.dumps({"error": str(e)})


class ToolRegistry:
    """Holds available tools and generates the tool description prompt."""

    def __init__(self):
        self.tools: dict[str, Tool] = {}

    def register(self, name: str, description: str, parameters: dict[str, str],
                 func: Callable):
        self.tools[name] = Tool(name, description, parameters, func)

    def get(self, name: str) -> Tool | None:
        return self.tools.get(name)

    def tool_descriptions(self) -> str:
        lines = []
        for t in self.tools.values():
            params = ", ".join(f'"{k}": "<{v}>"' for k, v in t.parameters.items())
            lines.append(f'- **{t.name}**: {t.description}')
            lines.append(f'  Parameters: {{{params}}}')
        return "\n".join(lines)


# ── Agent ────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a medical imaging assistant that helps sonographers during ultrasound exams.
You have access to tools. To use a tool, respond with EXACTLY this JSON format on a single line:

{{"tool": "<tool_name>", "args": {{<arguments>}}}}

When you have the final answer, respond with:

{{"answer": "<your response to the user>"}}

RULES:
- Output ONLY one JSON object per turn. No other text before or after.
- If the user request needs multiple steps, do ONE tool call per turn.
- After seeing a tool result, decide whether to call another tool or give the final answer.
- If no tool is needed, respond with the answer directly.
- For "analyze image" requests, use analyze_image. For "generate report", use generate_report.
- Always include the video_id when you have it.

Available tools:
{tools}
"""


def _extract_json(text: str) -> dict | None:
    """Try to extract a JSON object from the LLM response."""
    text = text.strip()
    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try to find JSON in the text
    for pattern in [
        r'\{[^{}]*"tool"[^{}]*\}',
        r'\{[^{}]*"answer"[^{}]*\}',
    ]:
        m = re.search(pattern, text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                continue

    # Try finding any JSON block
    brace_start = text.find("{")
    if brace_start >= 0:
        depth = 0
        for i in range(brace_start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[brace_start : i + 1])
                    except json.JSONDecodeError:
                        break
    return None


class Agent:
    """ReAct-style tool-using agent backed by a local LLM pipeline."""

    def __init__(self, llm_pipeline, tool_registry: ToolRegistry, max_iterations: int = 5,
                 gpu_lock=None):
        self.pipe = llm_pipeline
        self.registry = tool_registry
        self.max_iterations = max_iterations
        self._gpu_lock = gpu_lock

    def run(self, user_message: str, video_id: str = "") -> dict:
        """
        Run the agent loop.

        Returns:
            {
                "answer": str,        # final answer text
                "tool_calls": [...],   # list of tool calls made
                "iterations": int,
                "elapsed_ms": float,
            }
        """
        import openvino_genai as ov_genai

        t0 = time.perf_counter()
        tool_calls = []

        system = SYSTEM_PROMPT.format(tools=self.registry.tool_descriptions())
        if video_id:
            system += f"\n\nCurrent video_id: {video_id}"

        messages = ov_genai.ChatHistory()
        messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user_message})

        for iteration in range(self.max_iterations):
            if self._gpu_lock:
                with self._gpu_lock, metrics.timer("agent_llm_call"):
                    output = self.pipe.generate(messages, max_new_tokens=512, temperature=0.1)
            else:
                with metrics.timer("agent_llm_call"):
                    output = self.pipe.generate(messages, max_new_tokens=512, temperature=0.1)

            llm_text = output.texts[0] if hasattr(output, "texts") and output.texts else str(output)
            llm_text = llm_text.strip()
            print(f"  [Agent iter={iteration}] LLM: {llm_text[:200]}")

            parsed = _extract_json(llm_text)

            if parsed is None:
                # LLM didn't produce valid JSON — treat as final answer
                return {
                    "answer": llm_text,
                    "tool_calls": tool_calls,
                    "iterations": iteration + 1,
                    "elapsed_ms": (time.perf_counter() - t0) * 1000,
                }

            if "answer" in parsed:
                return {
                    "answer": str(parsed["answer"]),
                    "tool_calls": tool_calls,
                    "iterations": iteration + 1,
                    "elapsed_ms": (time.perf_counter() - t0) * 1000,
                }

            if "tool" in parsed:
                tool_name = parsed["tool"]
                tool_args = parsed.get("args", {})

                # Inject video_id if the tool needs it but it's missing
                tool = self.registry.get(tool_name)
                if tool is None:
                    tool_result = json.dumps({"error": f"Unknown tool: {tool_name}"})
                else:
                    if "video_id" in tool.parameters and "video_id" not in tool_args and video_id:
                        tool_args["video_id"] = video_id

                    print(f"  [Agent] Calling tool: {tool_name}({tool_args})")
                    with metrics.timer(f"agent_tool_{tool_name}"):
                        tool_result = tool.run(**tool_args)

                tool_calls.append({
                    "tool": tool_name,
                    "args": tool_args,
                    "result_preview": tool_result[:200] if len(tool_result) > 200 else tool_result,
                })

                # Feed result back to LLM
                messages.append({"role": "assistant", "content": llm_text})
                messages.append({"role": "user", "content": f"Tool result: {tool_result}"})
            else:
                # Neither tool nor answer — treat as answer
                return {
                    "answer": llm_text,
                    "tool_calls": tool_calls,
                    "iterations": iteration + 1,
                    "elapsed_ms": (time.perf_counter() - t0) * 1000,
                }

        # Max iterations reached
        return {
            "answer": "I wasn't able to complete the request within the allowed steps.",
            "tool_calls": tool_calls,
            "iterations": self.max_iterations,
            "elapsed_ms": (time.perf_counter() - t0) * 1000,
        }
