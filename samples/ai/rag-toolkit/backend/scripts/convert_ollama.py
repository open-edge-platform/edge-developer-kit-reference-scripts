# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sys
import json
import argparse
from pathlib import Path

from template import ollama_template

MODELFILE_TEMPLATE = '''FROM ../llm

TEMPLATE """{chat_template}"""
'''


def create_modelfile(model_path, save_path):
    with open(f"{model_path}/config.json", 'r') as f:
        _data = f.read()
        model_data = json.loads(_data)

    chat_template = ollama_template[model_data['model_type']]
    data = MODELFILE_TEMPLATE.format(chat_template=chat_template)
    with open(save_path, "w") as f:
        f.write(data)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description='Create a modified model file from a tokenizer.'
    )
    parser.add_argument(
        '--model_path',
        type=str,
        required=True,
        help='The identifier for the model file'
    )
    parser.add_argument(
        '--save_path',
        type=str,
        required=True,
        help='The path where the modified model file will be saved'
    )
    args = parser.parse_args(None if len(sys.argv) > 1 else ["--help"])

    safe_model_path = Path(args.model_path).resolve()
    if not safe_model_path.is_dir():
        print(f"Model path '{args.model_path}' is not a directory.")
        sys.exit(1)

    safe_save_path = Path(args.save_path).resolve()

    create_modelfile(safe_model_path, safe_save_path)
