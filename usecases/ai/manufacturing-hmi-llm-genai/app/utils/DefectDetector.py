# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 
from typing import Tuple

import numpy as np
from geti_sdk.data_models import Prediction
from geti_sdk.deployment import Deployment
from geti_sdk.utils import show_image_with_annotation_scene


class DefectDetector:
    """
    A class for loading and running a deployed Intel Geti model to detect defects 
    in image frames and generate annotated visualizations.
    """

    def __init__(self, deployment_path: str, device: str = 'CPU') -> None:
        """
        Initialize the defect detector by loading the deployment and inference models.

        Args:
            deployment_path (str): Path to the exported Geti deployment folder.
            device (str): The device to run inference on ('CPU', 'GPU', etc.). 
                                    Defaults to 'CPU'.
        """
        self.deployment = Deployment.from_folder(deployment_path)
        self.deployment.load_inference_models(device)

    def detect_defect(self, frame: np.ndarray) -> Tuple[Prediction, bool]:
        """
        Run inference on a frame and determine if a defect is present.

        Args:
            frame (np.ndarray): The input image/frame to analyze.

        Returns:
            Tuple[Prediction, bool]: A tuple containing:
                - prediction (Prediction): The result from the inference, including annotations.
                - bool: True if a defect is detected (i.e., any label other than "No Object"),
                        False if only "No Object" is found in all predictions.
        """
        prediction = self.deployment.infer(frame)
        for bbox_data in prediction.annotations:
            for label in bbox_data.labels:
                if label.name != "No Object":
                    return prediction, True  # Defect found

        return prediction, False  # Only "No Object" found

    def get_annotated_frame(self, frame: np.ndarray, prediction: Prediction) -> np.ndarray:
        """
        Generate an annotated image using the prediction results.

        Args:
            frame (np.ndarray): The original image/frame.
            prediction (Prediction): The prediction result returned from `detect_defect`.

        Returns:
            np.ndarray: The image with drawn bounding boxes and labels, without displaying it.
        """
        return show_image_with_annotation_scene(frame, prediction, show_results=False)
