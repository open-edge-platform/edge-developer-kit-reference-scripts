# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Client for the Text Generation service's OpenAI-compatible chat completions API."""
import json
import requests
import logging
from typing import Optional

from worker_common import CancelToken, JobCancelled

logger = logging.getLogger(__name__)

#: Seconds to wait for the text generation service to accept the connection.
CONNECT_TIMEOUT_SECONDS = 10

class TextGenClient:
    def __init__(self, base_url: str, model: str, timeout: int = 120, connect_timeout: float = CONNECT_TIMEOUT_SECONDS):
        self.model = model
        # Longest wait for the next piece of a streamed answer (incl. the first), not for the
        # whole answer.
        self.timeout = timeout
        self.connect_timeout = connect_timeout
        
        base_url = base_url.rstrip('/')
        
        if base_url.endswith('/chat/completions'):
            self.api_url = base_url
            self.base_url = base_url.replace('/chat/completions', '')
        else:
            self.base_url = base_url
            self.api_url = f"{base_url}/chat/completions"
        
        logger.debug(f"Initialized client - Base URL: {self.base_url}, API URL: {self.api_url}")
    
    def test_connection(self) -> bool:
        try:
            test_url = self.base_url
            logger.debug(f"Testing connection to: {test_url}")
            
            response = requests.get(test_url, timeout=5)
            logger.info(f"Connection test response: {response.status_code}")

            if response.status_code in [200, 404, 405]:
                return True
            else:
                logger.warning(f"Unexpected response code: {response.status_code}")
                return False
                
        except requests.exceptions.ConnectionError as e:
            logger.error(f"Connection refused - OpenVINO service may not be running: {e}")
            return False
        except Exception as e:
            logger.error(f"Connection test failed: {e}")
            return False
    
    def chat_completion(self, system_prompt: str, user_prompt: str, cancel: Optional[CancelToken] = None) -> str:
        """Chat completion, streamed so the time limits apply between pieces, not to the whole answer.

        ``cancel`` is checked before the request and per streamed line; closing the response then
        makes the engine stop generating.
        """
        try:
            if cancel is not None:
                cancel.check()
            payload = {
                "model": self.model,
                "messages": [
                    {
                        "role": "system",
                        "content": system_prompt
                    },
                    {
                        "role": "user", 
                        "content": user_prompt
                    }
                ],
                "stream": True,
                "max_tokens": 4000,
                "temperature": 0.3,
                # "/no_think" in the prompt only works on Qwen3; others would think up to max_tokens.
                "chat_template_kwargs": {"enable_thinking": False},
                # With thinking off, "</think>" is an artifact (Qwen3.5 int4 may repeat it to
                # max_tokens), so the answer ends there.
                "stop": ["</think>"],
            }
            
            logger.debug(f"Making POST request to {self.api_url}")
            logger.debug(f"Model: {self.model}")
            logger.debug(f"Payload: {payload}")
            
            with requests.post(
                self.api_url,
                json=payload,
                timeout=(self.connect_timeout, self.timeout),
                headers={'Content-Type': 'application/json', 'Accept': 'text/event-stream'},
                stream=True,
            ) as response:
                logger.info(f"Response status: {response.status_code}")

                if response.status_code == 404:
                    logger.error(f"API endpoint not found: {self.api_url}")
                    logger.error(f"Response body: {response.text}") 
                    logger.error("Make sure OpenVINO Model Server is running and the endpoint is correct")
                    raise Exception(f"API endpoint not found: {self.api_url} | Response: {response.text}")

                elif response.status_code == 405:
                    logger.error(f"Method Not Allowed - endpoint may not support POST: {self.api_url}")
                    logger.error(f"Response body: {response.text}")
                    raise Exception(f"API request failed with status {response.status_code}: {response.text}")

                elif response.status_code == 422:
                    logger.error(f"Validation error - check model name and parameters: {response.text}")
                    raise Exception(f"Validation error: {response.text}")

                elif response.status_code != 200:
                    logger.error(f"API request failed with status {response.status_code}: {response.text}")
                    raise Exception(f"API request failed with status {response.status_code}: {response.text}")

                content_type = response.headers.get("Content-Type", "")
                if "text/event-stream" in content_type:
                    content = self._read_stream(response, cancel)
                else:
                    # A server that ignores "stream" answers with one JSON body.
                    content = self._read_completion(response.json())

            logger.debug(f"Extracted content: {content[:200]}...")
            return content.strip()
                
        except JobCancelled:
            raise
        except requests.exceptions.RequestException as e:
            logger.error(f"Request exception: {e}")
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f"Response status: {e.response.status_code}")
            raise Exception(f"Text generation request failed: {e}")
        except Exception as e:
            logger.error(f"Text generation request failed: {e}")
            raise

    @staticmethod
    def _read_stream(response: requests.Response, cancel: Optional[CancelToken] = None) -> str:
        """The text of a streamed chat completion: every delta, in order."""
        parts: list[str] = []
        finished = False
        for raw_line in response.iter_lines():
            if cancel is not None:
                cancel.check()
            # Lines split on newline bytes, so a multi-byte character is never
            # cut in half here.
            line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
            if not line.startswith("data:"):
                continue
            data = line[len("data:"):].strip()
            if data == "[DONE]":
                finished = True
                break
            if not data:
                continue
            chunk = json.loads(data)
            if chunk.get("error"):
                raise Exception(f"Text generation failed: {chunk['error']}")
            for choice in chunk.get("choices") or []:
                if choice.get("index", 0) != 0:
                    continue
                delta = choice.get("delta") or {}
                piece = delta.get("content")
                if piece is None:
                    piece = choice.get("text")
                if piece:
                    parts.append(piece)
                if choice.get("finish_reason"):
                    finished = True
        if not parts and not finished:
            raise Exception("Invalid response format - the stream ended without any content")
        return "".join(parts)

    @staticmethod
    def _read_completion(result: dict) -> str:
        """The text of a non-streamed chat completion."""
        logger.debug(f"Response: {result}")

        if 'choices' in result and len(result['choices']) > 0:
            choice = result['choices'][0]

            # Handle both completion and chat completion response formats
            if 'message' in choice and 'content' in choice['message']:
                return choice['message']['content']
            elif 'text' in choice:
                return choice['text']
            logger.error(f"Unexpected response format: {choice}")
            raise Exception("Invalid response format - no content found")
        logger.error(f"Invalid response format: {result}")
        raise Exception("Invalid response format - no choices found")
