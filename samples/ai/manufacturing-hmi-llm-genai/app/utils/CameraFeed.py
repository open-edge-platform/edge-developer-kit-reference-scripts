# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 
import os
import platform

import cv2


class CameraFeed:
    def __init__(self, camera_id: int = 0, focus: int = 25) -> None:
        """
        Initializes the CameraFeed object by setting up the camera capture, focus, and related parameters.
        
        Args:
            camera_id (int): The unique identifier for the camera (default is "0").
            focus (int): The focus level for the camera (default is 25).
        """
        self.camera_id = camera_id
        self.focus = focus
        self.cap = None
        self.frame = None
        self.frame_bytes = None
        self.stop_trigger = False
        self._initialize_capture()
        self._setup_capture()
        self._check_capture()
    
    def _initialize_capture(self) -> None:
        """
        Initialize the video capture from the webcam.

        This method selects the appropriate video capture method based on the
        operating system (Linux or Windows). It attempts to open the default
        webcam (device index 0). If the platform is unsupported, it raises a
        RuntimeError.

        Raises:
            RuntimeError: If the current platform is not supported.
        """

        if platform.system() == "Linux":
            self.cap = cv2.VideoCapture(self.camera_id)
        elif platform.system() =="Windows":
            self.cap = cv2.VideoCapture(self.camera_id, cv2.CAP_DSHOW)
        else:
            raise RuntimeError(f"The demo is not supported on current platform: {platform.system()}")

    def _setup_capture(self) -> None:
        """
        Configure camera parameters for video capture.

        This method sets up various camera properties, including:
        - Disabling autofocus.
        - Setting the focus to the specified level.
        - Configuring the video codec and frame rate.
        """
        
        print("Setting up camera with parameters")
        self.cap.set(cv2.CAP_PROP_AUTOFOCUS, 0) # Autofocus close
        self.cap.set(cv2.CAP_PROP_FOCUS, self.focus)
        fourcc = cv2.VideoWriter_fourcc('M','J','P','G')
        self.cap.set(cv2.CAP_PROP_FOURCC, fourcc)
        self.cap.set(cv2.CAP_PROP_FPS, 60)

    def _check_capture(self) -> None:
        """
        Verify that the camera is opened and ready for capture.

        This method checks if the video capture object is successfully opened.
        If it is not opened, it raises an IOError.

        Raises:
            IOError: If the webcam cannot be opened.
        """
        
        if not self.cap.isOpened():
            raise IOError("Cannot open webcam")
        
    def adjust_focus(self, mode: str) -> None:
        """
        Adjust the camera's focus.

        This method increases or decreases the focus of the camera based on
        the provided mode. The focus value is adjusted by 5 units.

        Args:
            mode (str): The mode to adjust the focus. Should be "increase" or "decrease".
        """

        if mode == "increase":
            self.focus += 5
            self.cap.set(cv2.CAP_PROP_FOCUS, self.focus)
        elif mode == "decrease":
            self.focus -= 5
            self.cap.set(cv2.CAP_PROP_FOCUS, self.focus)

    def _release(self):
        """
        Release the video capture object and close all OpenCV windows.

        This method releases the camera resource and ensures that all OpenCV
        windows are properly closed to free up resources.
        """
            
        self.cap.release()
        cv2.destroyAllWindows()

    def generate_feed(self):
        """
        Continuously captures frames from the video capture device (e.g., webcam),
        processes them, and streams them as JPEG images for MJPEG video streaming.

        This method reads frames from the video capture device in a loop, converts
        the frames from BGR (OpenCV default) to RGB format, encodes the frames as
        JPEG images, and yields each JPEG image in a multipart HTTP response format
        suitable for MJPEG streaming. This allows real-time video streaming to a 
        client via HTTP.

        The method does not return a value; instead, it yields the frames one by one 
        to be transmitted to the client as part of an MJPEG stream. It continues to 
        yield frames until the video capture is no longer successful.

        Yields:
            bytes: A part of the MJPEG stream, representing a JPEG-encoded frame, 
                in the multipart format required for MJPEG video streaming.
                
        Example of usage in MJPEG streaming:
            yield (b'--frame\r\n'
                b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n\r\n')

        Notes:
            - The method uses OpenCV's `cv2.VideoCapture` to capture video frames 
            from the camera device.
            - Each frame is encoded into JPEG format and converted to a byte sequence 
            before being yielded.
            - The MJPEG format sends individual JPEG images with boundaries between 
            each frame to enable continuous video playback in browsers.
        """
        while True:
            # Capture frame-by-frame
            ret, self.frame = self.cap.read()
            if not ret:
                break

            # Encode the frame as JPEG
            ret, jpeg = cv2.imencode('.jpg', self.frame)
            if not ret:
                continue

            # Convert the encoded frame to bytes
            self.frame_bytes = jpeg.tobytes()

            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

            if self.stop_trigger:
                self._release()
                break

            # Yield the frame in the multipart format for MJPEG streaming
            yield (b'--frame\r\n'
                b'Content-Type: image/jpeg\r\n\r\n' + self.frame_bytes + b'\r\n\r\n')

    def get_pre_processed_frame(self):
        """
        Obtain a pre-processed version of the current frame.

        This method converts the current frame from BGR to RGB format for
        further processing or inference.

        Returns:
            The pre-processed frame in RGB format.
        """

        processed_frame = cv2.cvtColor(self.frame, cv2.COLOR_BGR2RGB)

        return processed_frame

    def save_frame(self, image_path, frame):
        """
        Save an OpenCV frame as an image at the specified path.
        The image format is determined automatically from the file extension.

        Args:
            path (str): The full path including filename and extension 
                        (e.g., 'output/frame.png', 'frame.jpg').
            frame (numpy.ndarray): The frame to save.

        Raises:
            ValueError: If the file extension is not supported by OpenCV.
        """
        # Check if the file extension is supported by OpenCV
        supported_extensions = ['.bmp', '.dib', '.jpeg', '.jpg', '.jpe', '.jp2',
                                '.png', '.webp', '.pbm', '.pgm', '.ppm', '.sr', '.ras', '.tiff', '.tif']
        ext = os.path.splitext(image_path)[1].lower()
        if ext not in supported_extensions:
            raise ValueError(f"Unsupported file format '{ext}'. Supported formats: {supported_extensions}")

        success = cv2.imwrite(image_path, frame)
        if not success:
            raise IOError(f"Failed to save image to {image_path}")


    def set_stop_trigger(self) -> None:
        """
        Set the stop trigger to true.

        This method signals the system to stop the ongoing operations, which
        can be used to terminate processes such as video capture or frame
        display.
        """
        
        self.stop_trigger = True

if __name__ == "__main__":
    # Example usage
    camera = CameraFeed(0, 35)  # Use the default camera (0)

