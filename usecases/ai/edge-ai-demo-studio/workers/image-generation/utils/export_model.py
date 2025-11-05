#
# Copyright (c) 2024 Intel Corporation
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

import argparse
import os
import sys
import subprocess  # nosec -- used to run optimum cli in a secured environment
import jinja2
import json

# Templates
image_generation_graph_template = """input_stream: "HTTP_REQUEST_PAYLOAD:input"
output_stream: "HTTP_RESPONSE_PAYLOAD:output"

node: {
  name: "ImageGenExecutor"
  calculator: "ImageGenCalculator"
  input_stream: "HTTP_REQUEST_PAYLOAD:input"
  input_side_packet: "IMAGE_GEN_NODE_RESOURCES:pipes"
  output_stream: "HTTP_RESPONSE_PAYLOAD:output"
  node_options: {
    [type.googleapis.com / mediapipe.ImageGenCalculatorOptions]: {
      models_path: "{{model_path}}",
      {%- if plugin_config_str %}
      plugin_config: '{{plugin_config_str}}',{% endif %}
      device: "{{target_device|default("CPU", true)}}",
      {%- if resolution %}
      resolution: "{{resolution}}",{% endif %}
      {%- if num_images_per_prompt %}
      num_images_per_prompt: {{num_images_per_prompt}},{% endif %}
      {%- if guidance_scale %}
      guidance_scale: {{guidance_scale}},{% endif %}
      {%- if max_resolution %}
      max_resolution: '{{max_resolution}}',{% endif %}
      {%- if default_resolution %}
      default_resolution: '{{default_resolution}}',{% endif %}
      {%- if max_num_images_per_prompt > 0 %}
      max_num_images_per_prompt: {{max_num_images_per_prompt}},{% endif %}
      {%- if default_num_inference_steps > 0 %}
      default_num_inference_steps: {{default_num_inference_steps}},{% endif %}
      {%- if max_num_inference_steps > 0 %}
      max_num_inference_steps: {{max_num_inference_steps}},{% endif %}
    }
  }
}"""


def get_optimum_cli_path():
    """
    Get the path to optimum-cli, checking the virtual environment first.
    """
    # Check if we're in a virtual environment
    if hasattr(sys, "real_prefix") or (
        hasattr(sys, "base_prefix") and sys.base_prefix != sys.prefix
    ):
        # We're in a virtual environment
        venv_bin = os.path.dirname(sys.executable)
        if os.name == "nt":  # if running on Windows
            optimum_cli_filename = "optimum-cli.exe"
        else:
            optimum_cli_filename = "optimum-cli"
        optimum_cli_path = os.path.join(venv_bin, optimum_cli_filename)
        if os.path.isfile(optimum_cli_path):
            return optimum_cli_path

    # Fall back to system PATH
    return "optimum-cli"


def run_optimum_command(command_args):
    """
    Run optimum-cli command with proper error handling.
    """
    optimum_cli = get_optimum_cli_path()
    full_command = [optimum_cli] + command_args

    try:
        process = subprocess.Popen(
            full_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        for line in process.stdout:
            print(line, end="")  # or handle line however you want
        for line in process.stderr:
            print(line, end="")  # or handle line however you want

        process.stderr.close()
        process.stdout.close()
        process.wait()
        return process.returncode
    except subprocess.CalledProcessError as e:
        print(f"Command failed: {' '.join(full_command)}")
        print(f"Error: {e.stderr}")
        return e.returncode
    except FileNotFoundError as e:
        print(
            f"optimum-cli not found. Please make sure optimum[openvino] is installed."
        )
        print(f"Tried to run: {' '.join(full_command)}")
        return 1


def add_servable_to_config(config_path, mediapipe_name, base_path):
    print(config_path, mediapipe_name, base_path)
    if not os.path.isfile(config_path):
        print("Creating new config file")
        with open(config_path, "w") as config_file:
            json.dump(
                {"mediapipe_config_list": [], "model_config_list": []},
                config_file,
                indent=4,
            )
    with open(config_path, "r") as config_file:
        config_data = json.load(config_file)
        if "mediapipe_config_list" not in config_data:
            config_data["mediapipe_config_list"] = []
        mp_list = config_data["mediapipe_config_list"]
        updated = False
        for mp_config in mp_list:
            if mp_config["name"] == mediapipe_name:
                mp_config["base_path"] = base_path
                updated = True
        if not updated:
            mp_list.append({"name": mediapipe_name, "base_path": base_path})
    with open(config_path, "w") as config_file:
        json.dump(config_data, config_file, indent=4)
    print("Added servable to config file", config_path)


def export_image_generation_model(
    model_repository_path,
    source_model,
    model_name,
    precision,
    task_parameters,
    config_file_path,
    num_streams,
):
    model_path = "./"
    target_path = os.path.join(model_repository_path, model_name)
    model_index_path = os.path.join(target_path, "model_index.json")

    if os.path.isfile(model_index_path):
        print(
            "Model index file already exists. Skipping conversion, re-generating graph only."
        )
    else:
        if task_parameters["extra_quantization_params"] is None:
            task_parameters["extra_quantization_params"] = ""

        # Prepare optimum-cli command arguments
        command_args = [
            "export",
            "openvino",
            "--model",
            source_model,
            "--weight-format",
            precision,
            "--trust-remote-code",
        ]

        # Add extra quantization params if present
        if task_parameters["extra_quantization_params"]:
            command_args.extend(task_parameters["extra_quantization_params"].split())

        # Add output path
        command_args.append(target_path)

        if run_optimum_command(command_args):
            raise ValueError("Failed to export image generation model", source_model)

    plugin_config = {}
    assert num_streams >= 0, "num_streams should be a non-negative integer"
    if num_streams > 0:
        plugin_config["NUM_STREAMS"] = num_streams
    if (
        "ov_cache_dir" in task_parameters
        and task_parameters["ov_cache_dir"] is not None
    ):
        plugin_config["CACHE_DIR"] = task_parameters["ov_cache_dir"]

    if len(plugin_config) > 0:
        task_parameters["plugin_config_str"] = json.dumps(plugin_config)

    # assert that max_resolution if exists, is in WxH format
    for param in ["max_resolution", "default_resolution"]:
        if task_parameters[param]:
            if "x" not in task_parameters[param]:
                raise ValueError(param + " should be in WxH format, e.g. 1024x768")
            width, height = task_parameters[param].split("x")
            if not (width.isdigit() and height.isdigit()):
                raise ValueError(
                    param
                    + " should be in WxH format with positive integers, e.g. 1024x768"
                )
            task_parameters[param] = "{}x{}".format(int(width), int(height))

    gtemplate = jinja2.Environment(
        loader=jinja2.BaseLoader, autoescape=True
    ).from_string(image_generation_graph_template)
    graph_content = gtemplate.render(model_path=model_path, **task_parameters)
    with open(os.path.join(model_repository_path, model_name, "graph.pbtxt"), "w") as f:
        f.write(graph_content)
    print(
        "Created graph {}".format(
            os.path.join(model_repository_path, model_name, "graph.pbtxt")
        )
    )
    add_servable_to_config(
        config_file_path,
        model_name,
        os.path.relpath(
            os.path.join(model_repository_path, model_name),
            os.path.dirname(config_file_path),
        ),
    )


def add_common_arguments(parser):
    parser.add_argument(
        "--model_repository_path",
        required=False,
        default="models",
        help="Where the model should be exported to",
        dest="model_repository_path",
    )
    parser.add_argument(
        "--source_model",
        required=True,
        help="HF model name or path to the local folder with PyTorch or OpenVINO model",
        dest="source_model",
    )
    parser.add_argument(
        "--model_name",
        required=False,
        default=None,
        help="Model name that should be used in the deployment. Equal to source_model if HF model name is used",
        dest="model_name",
    )
    parser.add_argument(
        "--weight-format",
        default="int8",
        help="precision of the exported model",
        dest="precision",
    )
    parser.add_argument(
        "--config_file_path",
        default="config.json",
        help="path to the config file",
        dest="config_file_path",
    )
    parser.add_argument(
        "--overwrite_models",
        default=False,
        action="store_true",
        help="Overwrite the model if it already exists in the models repository",
        dest="overwrite_models",
    )
    parser.add_argument(
        "--target_device",
        default="CPU",
        help="CPU, GPU, NPU or HETERO, default is CPU",
        dest="target_device",
    )
    parser.add_argument(
        "--ov_cache_dir",
        default=None,
        help="Folder path for compilation cache to speedup initialization time",
        dest="ov_cache_dir",
    )
    parser.add_argument(
        "--extra_quantization_params",
        required=False,
        help='Add advanced quantization parameters. Check optimum-intel documentation. Example: "--sym --group-size -1 --ratio 1.0 --awq --scale-estimation --dataset wikitext2"',
        dest="extra_quantization_params",
    )


def main():
    """Main function to handle command line arguments and execute model exports"""
    parser = argparse.ArgumentParser(
        description="Export Hugging face models to OVMS models repository including all configuration for deployments"
    )

    subparsers = parser.add_subparsers(
        help="subcommand help", required=True, dest="task"
    )

    parser_image_generation = subparsers.add_parser(
        "image_generation", help="export model for image generation endpoint"
    )
    add_common_arguments(parser_image_generation)
    parser_image_generation.add_argument(
        "--num_streams",
        default=0,
        type=int,
        help="The number of parallel execution streams to use for the models in the pipeline.",
        dest="num_streams",
    )
    parser_image_generation.add_argument(
        "--resolution",
        default="",
        help="Selection of allowed resolutions in a format of WxH; W=width H=height, space separated. If only one is selected, the pipeline will be reshaped to static.",
        dest="resolution",
    )
    parser_image_generation.add_argument(
        "--guidance_scale",
        default="",
        help="Static guidance scale for the image generation requests. If not specified, default 7.5f is used.",
        dest="guidance_scale",
    )
    parser_image_generation.add_argument(
        "--num_images_per_prompt",
        default="",
        help="Static number of images to be generated per the image generation request. If not specified, default 1 is used.",
        dest="num_images_per_prompt",
    )
    parser_image_generation.add_argument(
        "--max_resolution",
        default="",
        help="Max allowed resolution in a format of WxH; W=width H=height",
        dest="max_resolution",
    )
    parser_image_generation.add_argument(
        "--default_resolution",
        default="",
        help="Default resolution when not specified by client",
        dest="default_resolution",
    )
    parser_image_generation.add_argument(
        "--max_num_images_per_prompt",
        type=int,
        default=0,
        help="Max allowed number of images client is allowed to request for a given prompt",
        dest="max_num_images_per_prompt",
    )
    parser_image_generation.add_argument(
        "--default_num_inference_steps",
        type=int,
        default=0,
        help="Default number of inference steps when not specified by client",
        dest="default_num_inference_steps",
    )
    parser_image_generation.add_argument(
        "--max_num_inference_steps",
        type=int,
        default=0,
        help="Max allowed number of inference steps client is allowed to request for a given prompt",
        dest="max_num_inference_steps",
    )

    args = vars(parser.parse_args())

    if not os.path.isdir(args["model_repository_path"]):
        raise ValueError(
            f"The model repository path '{args['model_repository_path']}' is not a valid directory."
        )
    if args["source_model"] is None:
        args["source_model"] = args["model_name"]
    if args["model_name"] is None:
        args["model_name"] = args["source_model"]
    if args["model_name"] is None and args["source_model"] is None:
        raise ValueError("Either model_name or source_model should be provided")

    template_parameters = {
        k: v
        for k, v in args.items()
        if k
        not in [
            "model_repository_path",
            "source_model",
            "model_name",
            "precision",
            "version",
            "config_file_path",
            "overwrite_models",
        ]
    }
    print("template params:", template_parameters)

    if args["task"] == "image_generation":
        template_parameters = {
            k: v
            for k, v in args.items()
            if k
            in [
                "ov_cache_dir",
                "target_device",
                "resolution",
                "num_images_per_prompt",
                "guidance_scale",
                "max_resolution",
                "default_resolution",
                "max_num_images_per_prompt",
                "default_num_inference_steps",
                "max_num_inference_steps",
                "extra_quantization_params",
            ]
        }
        export_image_generation_model(
            args["model_repository_path"],
            args["source_model"],
            args["model_name"],
            args["precision"],
            template_parameters,
            args["config_file_path"],
            args["num_streams"],
        )


if __name__ == "__main__":
    main()
