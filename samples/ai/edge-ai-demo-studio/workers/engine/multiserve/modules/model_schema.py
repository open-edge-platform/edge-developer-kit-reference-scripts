from pydantic import BaseModel, ConfigDict, Field, field_validator, ValidationError
from typing import Optional, List, Dict


class StatusResponse(BaseModel):
    health: str


class TokenizeRequest(BaseModel):
    repo_id: str
    content: str
    add_special: Optional[bool] = Field(False, example=False)
    parse_special: Optional[bool] = Field(True, example=True)
    with_pieces: Optional[bool] = Field(False, example=False)
    return_len_only: Optional[bool] = Field(True, example=True)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "repo_id": "openvino:OpenVINO/Qwen3-8B-int4-ov",
                "content": "this is a test message",
                "add_special": False,
                "parse_special": True,
                "with_pieces": False,
                "return_len_only": True,
            }
        }
    )


class HybridModelRequest(BaseModel):
    repo_id: str = Field(
        ...,
        example="openvino:OpenVINO/Qwen3-8B-int4-ov",
    )
    task: str = Field(..., example="text_generation")
    context_size: Optional[int] = Field(default=0, example=4096)
    device: Optional[str] = Field(None, example="GPU")

    model_path: Optional[str] = Field(None, example="")
    mmproj_path: Optional[str] = Field(None, example="")

    llamacpp_extra_args: Optional[List[str]] = Field(
        None, example=["-fa", "1", "-ngl", "33"]
    )
    openvino_extra_params: Optional[Dict[str, str]] = Field(
        None, example={"weight-format": "int4"}
    )

    timeout: Optional[int] = Field(120, example=120)

    @field_validator("task")
    @classmethod
    def validate_task(cls, v: str) -> str:
        allowed_tasks = {
            "text_generation",
            "embeddings",
            "rerank",
            "multimodal",
        }
        if v not in allowed_tasks:
            raise ValueError(f"task must be one of: {', '.join(sorted(allowed_tasks))}")
        return v

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "repo_id": "openvino:OpenVINO/Qwen3-8B-int4-ov",
                "task": "text_generation",
                "model_path": "/models/GGUF/text_generation/OpenVINO/Qwen3-8B-int4-ov",
                "device": "CPU",
            }
        }
    )
