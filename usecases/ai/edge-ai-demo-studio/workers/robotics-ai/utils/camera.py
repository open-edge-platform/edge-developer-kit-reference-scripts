import logging
import time
from threading import Thread
from typing import Optional

import numpy as np

try:  # Allow running without RealSense hardware during debugging
    import pyrealsense2 as rs  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    rs = None

try:
    import cv2
except Exception:  # pragma: no cover - optional dependency
    cv2 = None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class BaseCameraStream(Thread):
    """Shared threading helpers for camera streams."""

    def __init__(self, width, height, fps, color_camera_queue, depth_camera_queue):
        super().__init__(daemon=True)
        self.width = width
        self.height = height
        self.fps = max(fps, 1)
        self.color_camera_queue = color_camera_queue
        self.depth_camera_queue = depth_camera_queue
        self.running = False

    def stop(self):
        self.running = False
        if self.is_alive():
            self.join(timeout=2)


class RealSenseCameraStream(BaseCameraStream):
    def __init__(
        self, camera_type, width, height, fps, color_camera_queue, depth_camera_queue
    ):
        if rs is None:
            raise RuntimeError(
                "pyrealsense2 is not available; cannot use RealSense camera stream"
            )

        super().__init__(width, height, fps, color_camera_queue, depth_camera_queue)
        self.camera_type = camera_type
        self.pipeline = rs.pipeline()
        self.config = rs.config()
        self.config.enable_stream(
            rs.stream.depth, self.width, self.height, rs.format.z16, self.fps
        )
        self.config.enable_stream(
            rs.stream.color, self.width, self.height, rs.format.bgr8, self.fps
        )
        self.depth_scale: Optional[float] = None
        self.depth_intrinsics = None

    def run(self):
        self.running = True
        profile = None
        try:
            logger.info("Starting RealSense pipeline...")
            profile = self.pipeline.start(self.config)

            if self.depth_scale is None:
                depth_sensor = profile.get_device().first_depth_sensor()
                self.depth_scale = depth_sensor.get_depth_scale()
                logger.info("RealSense depth scale: %s", self.depth_scale)

            color_sensor = profile.get_device().first_color_sensor()
            color_sensor.set_option(rs.option.enable_auto_white_balance, False)
            color_sensor.set_option(rs.option.sharpness, 100)

            while self.running:
                frames = self.pipeline.wait_for_frames()
                align_to = rs.stream.color
                align = rs.align(align_to)
                aligned_frames = align.process(frames)
                
                if self.depth_intrinsics is None:
                    aligned_depth_frame = aligned_frames.get_depth_frame()
                    self.depth_intrinsics = aligned_depth_frame.profile.as_video_stream_profile().get_intrinsics()
                    logger.info("RealSense intrinsics: %s", self.depth_intrinsics)
                
                color_frame = aligned_frames.get_color_frame()
                depth_frame = aligned_frames.get_depth_frame()
                if not depth_frame or not color_frame:
                    logger.warning("No frames received from RealSense camera.")
                    continue

                color_image = np.asanyarray(color_frame.get_data())
                depth_image = np.asanyarray(depth_frame.get_data())
                self.color_camera_queue.put(color_image)
                self.depth_camera_queue.put(depth_frame)

        except Exception as exc:
            logger.error("RealSense camera stream failed: %s", exc)
        finally:
            if profile is not None:
                try:
                    self.pipeline.stop()
                except Exception as exc:  # pragma: no cover - defensive
                    logger.warning("Failed to stop RealSense pipeline cleanly: %s", exc)
            self.running = False


class OpenCVCameraStream(BaseCameraStream):
    def __init__(
        self,
        width,
        height,
        fps,
        color_camera_queue,
        depth_camera_queue,
        device_index: int = 0,
    ):
        if cv2 is None:
            raise RuntimeError(
                "OpenCV is not available; cannot use OpenCV camera stream"
            )

        super().__init__(width, height, fps, color_camera_queue, depth_camera_queue)
        self.device_index = device_index
        self.capture = cv2.VideoCapture(self.device_index)
        if not self.capture.isOpened():
            raise RuntimeError(f"Unable to open webcam at index {self.device_index}")

        # Attempt to set resolution for consistency.
        self.capture.set(cv2.CAP_PROP_FRAME_WIDTH, float(self.width))
        self.capture.set(cv2.CAP_PROP_FRAME_HEIGHT, float(self.height))
        self.capture.set(cv2.CAP_PROP_FPS, float(self.fps))

    def run(self):
        self.running = True
        try:
            frame_interval = 1.0 / self.fps
            while self.running:
                ret, frame = self.capture.read()
                if not ret:
                    logger.warning("No frame received from OpenCV camera.")
                    time.sleep(frame_interval)
                    continue

                self.color_camera_queue.put(frame)
                depth_placeholder = np.zeros((self.height, self.width), dtype=np.uint16)
                self.depth_camera_queue.put(depth_placeholder)
                time.sleep(frame_interval)
        except Exception as exc:
            logger.error("OpenCV camera stream failed: %s", exc)
        finally:
            self.capture.release()
            self.running = False


class MockCameraStream(BaseCameraStream):
    def __init__(self, width, height, fps, color_camera_queue, depth_camera_queue):
        super().__init__(width, height, fps, color_camera_queue, depth_camera_queue)
        self.frame_counter = 0

    def _generate_frame(self) -> np.ndarray:
        frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        frame[:] = (30, 30, 30)
        timestamp = time.strftime("%H:%M:%S")
        label = f"Mock Camera • {timestamp} • frame {self.frame_counter:05d}"
        self.frame_counter += 1

        if cv2 is not None:
            cv2.putText(
                frame,
                label,
                (20, min(self.height - 20, 60)),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.0,
                (0, 200, 255),
                2,
                cv2.LINE_AA,
            )

        return frame

    def run(self):
        self.running = True
        frame_interval = 1.0 / self.fps
        try:
            while self.running:
                frame = self._generate_frame()
                self.color_camera_queue.put(frame)
                depth_placeholder = np.zeros((self.height, self.width), dtype=np.uint16)
                self.depth_camera_queue.put(depth_placeholder)
                time.sleep(frame_interval)
        finally:
            self.running = False


def create_camera_stream(
    camera_type: str,
    width: int,
    height: int,
    fps: int,
    color_camera_queue,
    depth_camera_queue,
):
    """Factory to create the requested camera stream implementation."""

    camera_key = (camera_type or "").lower()
    if camera_key in {"realsense", "intel_realsense", "rs"}:
        return RealSenseCameraStream(
            camera_key, width, height, fps, color_camera_queue, depth_camera_queue
        )
    if camera_key in {"opencv", "webcam", "usb"}:
        return OpenCVCameraStream(
            width, height, fps, color_camera_queue, depth_camera_queue
        )
    if camera_key in {"mock", "synthetic", "demo"}:
        logger.info("Using mock camera stream; no physical camera required")
        return MockCameraStream(
            width, height, fps, color_camera_queue, depth_camera_queue
        )

    raise ValueError(
        f"Unsupported camera type '{camera_type}'. Available types: realsense, opencv, mock"
    )
