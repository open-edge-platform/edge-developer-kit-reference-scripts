# Copyright (C) 2025 Intel Corporation
#
# This software and the related documents are Intel copyrighted materials,
# and your use of them is governed by the express license under which they
# were provided to you ("License"). Unless the License provides otherwise,
# you may not use, modify, copy, publish, distribute, disclose or transmit
# this software or the related documents without Intel's prior written
# permission.
#
# This software and the related documents are provided as is, with no express
# or implied warranties, other than those that are expressly stated in the License.

import argparse
import cv2
import numpy as np
import openvino as ov
import torch
import datetime

from ovmsclient import make_grpc_client
from pathlib import Path
from ultralytics import YOLO

# Global variable to store the duration
duration = 0

def load_model(config, model_version=1):
    core = ov.Core()
    models_dir = Path(config["models_dir"])
    models_dir.mkdir(exist_ok=True)
    model_path = models_dir / f"{config['model_name']}/{model_version}/{config['model_name']}.xml"

    # Download and convert model
    det_model = YOLO(models_dir / f"{config['model_name']}.pt")
    if not model_path.exists():
        det_model.export(format="openvino", dynamic=True, half=True)

    # Load model with OpenVINO
    det_ov_model = core.read_model(model_path)

    ov_config = {}
    if config["accelerator"] != "CPU":
        det_ov_model.reshape({0: [1, 3, 640, 640]})
    if "GPU" in config["accelerator"] or (
        "AUTO" in config["accelerator"] and "GPU" in core.get_available_devices()
    ):
        ov_config = {"GPU_DISABLE_WINOGRAD_CONVOLUTION": "YES"}

    det_compiled_model = core.compile_model(det_ov_model, config["accelerator"], ov_config)
    return det_model, det_compiled_model

def setup_inference(det_model, det_compiled_model, config):
    def infer(*args):
        global duration
        client = make_grpc_client(config["ovms_address"])
        inputs = {"x": np.transpose(np.array(args[0]), (0, 2, 3, 1))}  # Transpose input to match expected shape

        start_time = datetime.datetime.now()
        results = client.predict(model_name=config["model_name"], inputs=inputs)
        end_time = datetime.datetime.now()

        # Calculate duration to inference
        duration = (end_time - start_time).total_seconds() * 1000  # Duration in milliseconds

        results = torch.from_numpy(results)
        return results

    if det_model.predictor is None:
        custom = {
            "conf": 0.25,
            "batch": 1,
            "save": False,
            "mode": "predict",
        }
        args = {**det_model.overrides, **custom}
        det_model.predictor = det_model._smart_load("predictor")(
            overrides=args, _callbacks=det_model.callbacks
        )
        det_model.predictor.setup_model(model=det_model.model)
    det_model.predictor.model.ov_compiled_model = det_compiled_model
    det_model.predictor.inference = infer
    det_model.predictor.model.pt = False

def plot_diagram(det_model, image_path):
    res = det_model(image_path)
    result_image_with_labels = res[0].plot()[:, :, ::-1]  # Convert from RGB to BGR for OpenCV
    return result_image_with_labels

def save_and_display_image(image, output_path, display, save):
    image_bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
    if save:
        cv2.imwrite(output_path, image_bgr)

    # Display the image
    if display:
        cv2.imshow("Detections", image_bgr)
        cv2.waitKey(0)
        cv2.destroyAllWindows()

def main(config):
    global duration
    det_model, det_compiled_model = load_model(config, config["model_version"])
    setup_inference(det_model, det_compiled_model, config)

    result_image_with_labels = plot_diagram(det_model, config["image_path"])
    save_and_display_image(result_image_with_labels, config["output_image_path"], config["display"], config["save"])

    # Perform inference and calculate instantaneous latency and FPS
    fps = 1000 / duration
    print(f"latency: {duration:.2f} ms")
    print(f"FPS: {fps:.2f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="YOLO Inference with OpenVINO and OVMS")
    parser.add_argument("--accelerator", type=str, default="CPU", help="Accelerator to use (CPU, GPU, AUTO)")
    parser.add_argument("--models_dir", type=str, default="./models", help="Directory to store models")
    parser.add_argument("--model_name", type=str, default="yolo11n", help="Name of the model")
    parser.add_argument("--model_version", type=int, default=1, help="Version of the model")
    parser.add_argument("--image_path", type=str, default="images/bus_2.jpg", help="Path to the input image")
    parser.add_argument("--output_image_path", type=str, default="result_image_with_labels.jpg", help="Path to save the output image")
    parser.add_argument("--ovms_address", type=str, default="127.0.0.1:9000", help="Address of the OVMS server")
    parser.add_argument("--display", type=bool, default=False, help="Display the output image")
    parser.add_argument("--save", type=bool, default=False, help="Save the output image")

    args = parser.parse_args()

    config = {
        "accelerator"      : args.accelerator,
        "models_dir"       : args.models_dir,
        "model_name"       : args.model_name,
        "model_version"    : args.model_version,
        "image_path"       : args.image_path,
        "output_image_path": args.output_image_path,
        "ovms_address"     : args.ovms_address,
        "display"          : args.display,
        "save"             : args.save
    }
    main(config)
