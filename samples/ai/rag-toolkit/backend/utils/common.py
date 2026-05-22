# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import yaml

def read_config_file(config_path):
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config file not found in {config_path}")
    
    configs = None
    with open(config_path, 'r') as file:
        configs = yaml.safe_load(file)
        
    if configs == None:
        raise RuntimeError(f"Failed to get the configs from config file in {config_path}")
    
    return configs
