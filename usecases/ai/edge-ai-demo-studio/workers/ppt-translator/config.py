# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Configuration for PowerPoint Translator integrated with OpenVINO text generation system
"""
import logging
import requests


def fetch_active_model_config(
    status_url: str = "http://localhost:8001/v1/status",
    fallback_base_url: str = "http://localhost:8001/v1",
    fallback_model: str = "openvino:OpenVINO/Qwen3-4B-int8-ov",
    timeout: int = 5
) -> dict:
    """
    Dynamically fetch the active model and its URL from the
    text-generation service status endpoint.

    Provider prefixes:
        OVMS models      -> openvino:<repo_id>
        llama.cpp models -> llamacpp:<repo_id>

    Falls back to hardcoded values if:
        - Service is unreachable
        - No model is ready yet (url field is empty)
        - Any unexpected error occurs
    """
    logger = logging.getLogger(__name__)

    # Provider prefix mapping
    PROVIDER_PREFIX = {
        "ovms": "openvino",
        "llama.cpp": "llamacpp",
    }

    try:
        response = requests.get(status_url, timeout=timeout)

        if response.status_code != 200:
            logger.warning(
                f"Status endpoint returned {response.status_code}, "
                f"using fallback config"
            )
            return {
                "base_url": fallback_base_url,
                "model": fallback_model
            }

        status = response.json()
        logger.debug(f"Status response: {status}")

        # Check OVMS models first (OpenVINO)
        ovms_list = status.get("status", {}).get("ovms", [])
        for entry in ovms_list:
            repo_id = entry.get("repo_id", "")
            url = entry.get("url", "")
            task = entry.get("task", "")

            if task == "text_generation" and url and url.strip():
                base_url = f"{url}/v1"
                # Add openvino: prefix
                model = f"{PROVIDER_PREFIX['ovms']}:{repo_id}"
                logger.info(
                    f"Auto-detected OVMS model: {model} at {base_url}"
                )
                return {
                    "base_url": base_url,
                    "model": model
                }

        # Check llama.cpp models as fallback
        llamacpp_list = status.get("status", {}).get("llama.cpp", [])
        for entry in llamacpp_list:
            repo_id = entry.get("repo_id", "")
            url = entry.get("url", "")
            task = entry.get("task", "")

            if task == "text_generation" and url and url.strip():
                base_url = f"{url}/v1"
                # Add llamacpp: prefix
                model = f"{PROVIDER_PREFIX['llama.cpp']}:{repo_id}"
                logger.info(
                    f"Auto-detected llama.cpp model: {model} at {base_url}"
                )
                return {
                    "base_url": base_url,
                    "model": model
                }

        # No model ready yet, url field is empty
        logger.warning(
            "No ready model found in status response "
            "(url field is empty - model may still be loading). "
            "Using fallback config."
        )
        return {
            "base_url": fallback_base_url,
            "model": fallback_model
        }

    except requests.exceptions.ConnectionError:
        logger.warning(
            f"Cannot connect to {status_url}, using fallback config"
        )
        return {
            "base_url": fallback_base_url,
            "model": fallback_model
        }
    except requests.exceptions.Timeout:
        logger.warning(
            f"Status endpoint timed out, using fallback config"
        )
        return {
            "base_url": fallback_base_url,
            "model": fallback_model
        }
    except Exception as e:
        logger.warning(
            f"Failed to fetch model config: {e}, using fallback config"
        )
        return {
            "base_url": fallback_base_url,
            "model": fallback_model
        }


# Fetch active model config dynamically at startup
_active_config = fetch_active_model_config(
    status_url="http://localhost:8001/v1/status",
    fallback_base_url="http://localhost:8001/v1",
    fallback_model="openvino:OpenVINO/Qwen3-4B-int8-ov",
)

# OpenVINO Model Server configuration
LLAMA_CONFIG = {
    "base_url": _active_config["base_url"],  # Auto-fetched from status endpoint
    "model": _active_config["model"],        # Auto-fetched with provider prefix
    "max_tokens": 4000,
    "temperature": 0.3,
    "top_p": 0.9,
    "top_k": 50,
    "frequency_penalty": 0.0,
    "presence_penalty": 0.0,
    "stream": False,
}

# Translation behavior settings
TRANSLATION_CONFIG = {
    "source_language": "English",
    "target_language": "Simplified Chinese",
    "preserve_formatting": True,
    "translate_speaker_notes": True,
    "batch_size": 5,  # Reduced for better stability with OpenVINO
    "retry_attempts": 3,
    "timeout_seconds": 120,  # Increased timeout for OpenVINO processing
    "auto_adjust_font_size": True,
    "preserve_proper_nouns": False,
    "custom_preservation_rules": [
        "Do NOT translate ANY human names (Western, Asian, or any origin - keep exactly as written)",
        "Examples: Keep 'Zhang Wei', '李明', '田中', 'John Smith' all unchanged",
        "Preserve technical terms and acronyms when appropriate",
        "Keep URLs, email addresses, and file paths unchanged"
    ],
    "presentation_context": "",
    "translation_quality": "high",  # Options: "fast", "balanced", "high"
}

# Font size adjustment for different languages
FONT_SIZE_ADJUSTMENT = {
    "method": "dynamic",
    "dynamic": {
        "target_fill_ratio": 0.95,
        "min_adjustment": 0.7,
        "max_adjustment": 1.3,
        "min_size": 6.0,
        "max_size": 96.0,
    },
    "fixed": {
        "English->Simplified Chinese": 0.95,  # Chinese characters often need slightly smaller size
        "English->Traditional Chinese": 0.95,
        "English->Japanese": 0.95,
        "English->Korean": 0.95,
        "Simplified Chinese->English": 0.85,
        "Traditional Chinese->English": 0.85,
        "Japanese->English": 0.85,
        "Korean->English": 0.85,
        "English->Spanish": 0.95,
        "English->French": 0.9,
        "English->German": 0.85,
        "English->Russian": 0.9,
        "English->Arabic": 1.0,
        "default": 1.0,
    }
}

# File handling configuration
FILE_CONFIG = {
    "input_file": "",
    "output_file": "",
    "backup_original": True,  # Enable backup by default for safety
    "supported_formats": [".pptx", ".ppt"],
    "max_file_size_mb": 100,
    "temp_directory": "/tmp/ppt_translator",
}

# Logging configuration
LOGGING_CONFIG = {
    "level": logging.INFO,
    "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    "filename": "translation.log",
    "max_log_size_mb": 10,
    "backup_count": 5,
}

# Model presets optimized for different use cases
MODEL_PRESETS = {
    "qwen_fast": {
        "max_tokens": 2000,
        "temperature": 0.2,
        "top_k": 30,
        "system_prompt": "You are a professional translator. Translate quickly and accurately while preserving formatting.",
    },
    "qwen_balanced": {
        "max_tokens": 4000,
        "temperature": 0.3,
        "top_k": 50,
        "system_prompt": "You are a professional translator. Translate accurately while preserving all formatting and context.",
    },
    "qwen_high_quality": {
        "max_tokens": 6000,
        "temperature": 0.1,
        "top_k": 20,
        "system_prompt": "You are a professional translator with expertise in technical and business documents. Translate with highest accuracy while preserving all formatting, context, and nuances.",
    },
    "llama3": {
        "max_tokens": 8000,
        "temperature": 0.2,
        "system_prompt": "You are a professional translator. Translate accurately while preserving all formatting.",
    }
}

# Translation prompts for different content types
TRANSLATION_PROMPTS = {
    "general": {
        "system": "You are a professional translator. Translate the following text from {source_lang} to {target_lang}. Preserve all formatting, structure, and meaning.",
        "user_template": "Translate this text:\n\n{text}"
    },
    "business": {
        "system": "You are a professional business translator. Translate the following business content from {source_lang} to {target_lang}. Maintain professional tone and preserve all formatting.",
        "user_template": "Translate this business content:\n\n{text}"
    },
    "technical": {
        "system": "You are a technical translator with expertise in technology and engineering. Translate from {source_lang} to {target_lang}. Preserve technical terms when appropriate and maintain accuracy.",
        "user_template": "Translate this technical content:\n\n{text}"
    },
    "academic": {
        "system": "You are an academic translator. Translate the following academic content from {source_lang} to {target_lang}. Maintain scholarly tone and preserve citations and references.",
        "user_template": "Translate this academic content:\n\n{text}"
    }
}

# OpenVINO-specific settings
OPENVINO_CONFIG = {
    "connection_timeout": 30,
    "read_timeout": 120,
    "max_retries": 3,
    "retry_delay": 2,  # seconds between retries
    "health_check_interval": 60,  # seconds
    "model_warmup": True,  # Send a warmup request on startup
}

# Performance optimization settings
PERFORMANCE_CONFIG = {
    "parallel_processing": False,  # Disable for stability with single OpenVINO instance
    "max_concurrent_requests": 1,
    "request_queue_size": 10,
    "memory_optimization": True,
    "cache_translations": False,  # Disable caching for now
}

# Error handling configuration
ERROR_CONFIG = {
    "max_text_length": 8000,  # Maximum characters per translation request
    "fallback_on_error": True,
    "skip_on_repeated_failure": True,
    "error_log_detail": "full",  # Options: "minimal", "standard", "full"
}