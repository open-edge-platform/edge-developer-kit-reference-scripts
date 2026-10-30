# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import importlib
import logging
import pkgutil
from pathlib import Path
from typing import Callable, Dict, Type
from agentic_framework.base import BaseAgent

logger = logging.getLogger("agentic_framework.registry")

class AgentRegistry:
    """
    Registry for managing and dynamically launching agents in the framework.
    """
    def __init__(self):
        self._agents: Dict[str, Type[BaseAgent]] = {}

    def register(self, name: str, agent_cls: Type[BaseAgent]):
        self._agents[name] = agent_cls
        logger.debug("Registered agent '%s' -> %s", name, agent_cls.__name__)

    def get(self, name: str) -> Type[BaseAgent]:
        if name not in self._agents:
            # Attempt to auto-import from standard namespace
            try:
                mod = importlib.import_module(f"{name}.agent")
                for attr in dir(mod):
                    obj = getattr(mod, attr)
                    if isinstance(obj, type) and issubclass(obj, BaseAgent) and obj is not BaseAgent:
                        self.register(name, obj)
                        return obj
            except ImportError:
                pass
            raise KeyError(f"Agent '{name}' is not registered. Available agents: {list(self._agents.keys())}")
        return self._agents[name]

    def list_agents(self) -> Dict[str, str]:
        return {name: cls.__doc__.strip().splitlines()[0] if cls.__doc__ else "No description" for name, cls in self._agents.items()}

agent_registry = AgentRegistry()

def register_agent(name: str):
    def decorator(cls: Type[BaseAgent]):
        agent_registry.register(name, cls)
        return cls
    return decorator

def discover_agents() -> None:
    """Import every sibling package under src/ so their @register_agent decorators run."""
    src_dir = Path(__file__).resolve().parent.parent
    for _, module_name, is_pkg in pkgutil.iter_modules([str(src_dir)]):
        if not is_pkg or module_name == "agentic_framework":
            continue
        try:
            importlib.import_module(module_name)
        except ImportError as e:
            logger.warning("Failed to auto-import agent package '%s': %s", module_name, e)
