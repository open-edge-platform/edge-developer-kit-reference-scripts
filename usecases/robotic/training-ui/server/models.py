# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from pydantic import BaseModel
from typing import Optional, Union

class CameraInfo(BaseModel):
    checked: bool
    id: str
    name: str
    tag: str
    type: str
    fps: int

class PortInfo(BaseModel):
    teleop: str
    robot: str

class ConfigFile(BaseModel):
    cameras: Optional[list[CameraInfo]]
    episodes: Optional[int]
    framerate: Optional[int]
    instruction: str
    selectedPorts: Optional[PortInfo]

class ConfigStatus(BaseModel):
    configName: str
    configActivated: bool
    configData: ConfigFile
    
class ConfigRequest(BaseModel):
    configName: str
    configData: ConfigFile

class Project(BaseModel):
    name: str
    status: bool
    configData: ConfigFile

class ACTModel(BaseModel):
    actionChunks: int
    chunkSize: int

class GrootN1Model(BaseModel):
    actionSpace: str
    controlFrequency: int

class SmolVLA(BaseModel):
    modelWidth: str
    visualEncoder: str

class HyperParameter(BaseModel):
    steps: int
    logFreq: int
    saveFreq: int
    modelHyperparameters: Optional[Union[ACTModel, SmolVLA, GrootN1Model]]

class ModelRequest(BaseModel):
    sessionId: str
    model: str
    hyperparameters: HyperParameter
    deviceId: int
    dataset: str
    accelerator: str
    status: str
