import os
import cv2
import logging
from pathlib import Path

import torch
import openvino as ov
import supervision as sv
from ultralytics import FastSAM
from ultralytics.models.fastsam import FastSAMPredictor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class OVWrapper:
    def __init__(self, ov_model, device="CPU", stride=32, ov_config={}) -> None:
        core = ov.Core()
        logger.info(f"Compiling model with device: {device}")
        self.model = core.compile_model(ov_model, device, ov_config)
        self.stride = stride
        self.format = "openvino"
        self.pt = False
        self.fp16 = False
        self.names = {0: "object"}

    def __call__(self, im, **_):
        result = self.model(im)
        return torch.from_numpy(result[0]), torch.from_numpy(result[1])


class ObjectDetector:
    def __init__(self, model_name="FastSAM-s", device="CPU", imgsz=640, img_path="./data/coco_bike.jpg") -> None:
        self.model_name = model_name
        self.device = device
        self.imgsz = imgsz
        self.img_path = img_path

        if not Path(img_path).exists():
            raise FileNotFoundError(
                f"Required warm-up image not found: {img_path}")

        self.model = FastSAM(f"./models/{model_name}/{model_name}.pt")
        self.ov_model_path = Path(
            f"./models/{model_name}/{model_name}_openvino_model/{model_name}.xml"
        )

        self._init_ov_predictor(device=device)
        overrides = dict(
            conf=0.25,
            task="segment",
            mode="predict",
            model=f"./models/{model_name}/{model_name}.pt",
            save=False,
            imgsz=self.imgsz
        )
        self.predictor = FastSAMPredictor(overrides=overrides)

    def _convert_model(self, dynamic=False):
        if not self.ov_model_path.exists():
            logger.info(
                f"Exporting model to OpenVINO format, dynamic: {dynamic} ...")
            self.model.export(
                format="openvino",
                dynamic=dynamic,
                half=True,
                imgsz=self.imgsz
            )
            logger.info("Model exported successfully.")
        else:
            logger.info("OpenVINO model already exists. Skipping export.")

    def _init_ov_predictor(self, device="CPU"):
        logger.info(f"Initializing model on device: {device} ...")
        self._convert_model()

        logger.info("Running model warm-up ...")
        self.model(
            self.img_path,
            device="cpu",
            retina_masks=True,
            imgsz=self.imgsz,
            conf=0.6,
            iou=0.9
        )

        logger.info("Patching model predictor to run on OpenVINO ...")
        core = ov.Core()
        available_devices = core.available_devices
        if device.split(".")[0] not in available_devices:
            logger.warning(
                f"Requested device '{device}' is not available. Available devices: {available_devices}. Falling back to 'CPU'.")
            device = "CPU"

        ov_config = {}
        if "GPU" in device:
            logger.warning("Disabling Winograd convolution for GPU device.")
            ov_config = {"GPU_DISABLE_WINOGRAD_CONVOLUTION": "YES"}

        logger.info("Compiling OV model ...")
        wrapped_model = OVWrapper(
            self.ov_model_path,
            device=device,
            stride=self.model.predictor.model.stride,
            ov_config=ov_config
        )
        self.model.predictor.model = wrapped_model

    def inference(self, source, debug=False):
        if isinstance(source, str) and os.path.isfile(source):
            image_array = cv2.imread(source)
        else:
            image_array = source

        results = self.model(
            image_array,
            retina_masks=True,
            imgsz=self.imgsz,
            conf=0.6,
            iou=0.9
        )[0]

        detections = sv.Detections.from_ultralytics(results)
        logger.info(f"Detections: {len(detections)} objects found.")

        detection_results = {}
        for i, box in enumerate(detections.xyxy):
            cropped_img = image_array[int(box[1]):int(
                box[3]), int(box[0]):int(box[2])]
            detection_results[f"object_{i}"] = cropped_img

        if debug:
            # Create annotators
            bounding_box_annotator = sv.BoxAnnotator()
            label_annotator = sv.LabelAnnotator()

            # Annotate the image
            annotated_image = bounding_box_annotator.annotate(
                scene=image_array.copy(), detections=detections)
            annotated_image = label_annotator.annotate(
                scene=annotated_image, detections=detections)

            # Save the image in results dir
            cv2.imwrite(
                f"./results/detections_{self.model_name}.jpg", annotated_image)
            logger.info(
                f"Annotated image saved to ./results/detections_{self.model_name}.jpg")

        return results

    def _is_within_bbox(self, box, bboxes):
        x1, y1, x2, y2 = box
        for bbox in bboxes:
            bx1, by1, bx2, by2 = bbox
            if x1 >= bx1 and y1 >= by1 and x2 <= bx2 and y2 <= by2:
                return True
        return False

    def inference_with_bboxes(self, source, bboxes, debug=False):
        if isinstance(source, str) and os.path.isfile(source):
            image_array = cv2.imread(source)
        else:
            image_array = source

        results = self.model(
            image_array,
            retina_masks=True,
            imgsz=self.imgsz,
            conf=0.75,
            iou=0.9
        )[0]

        # Filter the results based on provided bboxes
        detections = sv.Detections.from_ultralytics(results)
        logger.info(f"Detections: {len(detections)} objects found.")

        detection_results = {}
        detection_id = 0
        for i, box in enumerate(detections.xyxy):
            # filter the result if not within any of the provided bboxes in xyxy format
            if not self._is_within_bbox(box, bboxes):
                continue
            cropped_img = image_array[int(box[1]):int(
                box[3]), int(box[0]):int(box[2])]

            mask = detections.mask[i] if detections.mask is not None else None
            detection_results[f"object_{detection_id}"] = {
                'image': cropped_img, 'box': box, 'mask': mask}
            detection_id += 1
            if debug:
                cv2.imwrite(
                    f"./results/cropped_{self.model_name}_{detection_id}.jpg", cropped_img)
                logger.info(
                    f"Cropped image saved to ./results/cropped_{self.model_name}_{detection_id}.jpg")

        if debug:
            # Create annotators
            bounding_box_annotator = sv.BoxAnnotator()
            label_annotator = sv.LabelAnnotator()

            # Annotate the image
            annotated_image = bounding_box_annotator.annotate(
                scene=image_array.copy(), detections=detections)
            annotated_image = label_annotator.annotate(
                scene=annotated_image, detections=detections)

            # Save the image in results dir
            cv2.imwrite(
                f"./results/detections_{self.model_name}.jpg", annotated_image)
            logger.info(
                f"Annotated image saved to ./results/detections_{self.model_name}.jpg")

        return detection_results


if __name__ == "__main__":
    image = cv2.imread("./data/coco_bike.jpg")
    detector = ObjectDetector("FastSAM-s")
    bboxes = [[150, 100, 200, 200]]  # List of bounding boxes
    results = detector.inference_with_bboxes(image, bboxes)
    logger.info(f"Number of object found in bbox: {len(results)}")
