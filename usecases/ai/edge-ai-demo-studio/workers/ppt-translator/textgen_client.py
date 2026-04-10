# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Client for OpenVINO text generation service using OpenAI-compatible API
"""
import requests
import logging

logger = logging.getLogger(__name__)

class TextGenClient:
    """Client that uses the OpenAI-compatible chat completions API with OpenVINO"""
    
    def __init__(self, base_url: str, model: str, timeout: int = 120):
        self.model = model
        self.timeout = timeout
        
        # Handle different URL formats and construct the correct chat completions endpoint
        base_url = base_url.rstrip('/')  # Remove trailing slash
        
        if base_url.endswith('/chat/completions'):
            # Full chat completions endpoint provided
            self.api_url = base_url
            self.base_url = base_url.replace('/chat/completions', '')
        else:
            # Base URL provided, construct chat completions endpoint
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
    
    def chat_completion(self, system_prompt: str, user_prompt: str) -> str:
        """Make a chat completion request using OpenAI-compatible format"""
        try:
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
                "stream": False,
                "max_tokens": 4000,
                "temperature": 0.3
            }
            
            logger.debug(f"Making POST request to {self.api_url}")
            logger.debug(f"Model: {self.model}")
            logger.debug(f"Payload: {payload}")
            
            response = requests.post(
                self.api_url,
                json=payload,
                timeout=self.timeout,
                headers={'Content-Type': 'application/json'}
            )
            
            logger.info(f"Response status: {response.status_code}")
            
            # Handle specific error cases
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
            
            result = response.json()
            logger.debug(f"Response: {result}")
            
            # Extract content from OpenAI-style response
            if 'choices' in result and len(result['choices']) > 0:
                choice = result['choices'][0]
                
                # Handle both completion and chat completion response formats
                if 'message' in choice and 'content' in choice['message']:
                    content = choice['message']['content']
                elif 'text' in choice:
                    content = choice['text']
                else:
                    logger.error(f"Unexpected response format: {choice}")
                    raise Exception("Invalid response format - no content found")
                
                logger.debug(f"Extracted content: {content[:200]}...")
                return content.strip()
            else:
                logger.error(f"Invalid response format: {result}")
                raise Exception("Invalid response format - no choices found")
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Request exception: {e}")
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f"Response status: {e.response.status_code}")
                logger.error(f"Response text: {e.response.text}")
            raise Exception(f"Text generation request failed: {e}")
        except Exception as e:
            logger.error(f"Text generation request failed: {e}")
            raise