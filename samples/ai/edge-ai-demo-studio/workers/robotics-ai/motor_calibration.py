"""Motor calibration using lerobot Python API directly (no subprocess).

This module replaces the fragile subprocess-based approach that used
`lerobot-calibrate` CLI with `input()` prompts over pipes. Instead, it calls
the lerobot bus methods directly in a background thread, using threading.Event
objects for synchronization with the HTTP API layer.
"""

import logging
import threading
import time
from pathlib import Path

from lerobot.motors import MotorCalibration, Motor, MotorNormMode
from lerobot.motors.feetech import FeetechMotorsBus, OperatingMode

logger = logging.getLogger(__name__)

# Motor calibration states
STATE_IDLE = "idle"
STATE_AWAITING_CHOICE = "awaiting_calibration_choice"
STATE_AWAITING_MIDDLE = "awaiting_middle_position"
STATE_AWAITING_RANGE = "awaiting_range_motion"
STATE_COMPLETE = "complete"
STATE_ERROR = "error"

FULL_TURN_MOTOR = "wrist_roll"

# Default SO-101 motor config
SO101_MOTORS = {
    "shoulder_pan": Motor(1, "sts3215", MotorNormMode.DEGREES),
    "shoulder_lift": Motor(2, "sts3215", MotorNormMode.DEGREES),
    "elbow_flex": Motor(3, "sts3215", MotorNormMode.DEGREES),
    "wrist_flex": Motor(4, "sts3215", MotorNormMode.DEGREES),
    "wrist_roll": Motor(5, "sts3215", MotorNormMode.DEGREES),
    "gripper": Motor(6, "sts3215", MotorNormMode.RANGE_0_100),
}


class MotorCalibrationSession:
    """Manages a single motor calibration session using lerobot API directly.

    State transitions:
        idle -> awaiting_calibration_choice (start)
        awaiting_calibration_choice -> complete (use_existing)
        awaiting_calibration_choice -> awaiting_middle_position (run)
        awaiting_middle_position -> awaiting_range_motion (confirm middle)
        awaiting_range_motion -> complete (confirm range)
        any -> error (on failure)
    """

    def __init__(self, port: str, robot_id: str, calibration_dir: str | None = None):
        self.port = port
        self.robot_id = robot_id
        self.calibration_dir = calibration_dir

        self._lock = threading.Lock()
        self._state: str = STATE_IDLE
        self._error_message: str | None = None
        self._joint_readings: list[dict] = []
        self._bus: FeetechMotorsBus | None = None
        self._advance_event = threading.Event()
        self._choice: str | None = None
        self._recording_thread: threading.Thread | None = None
        self._stop_recording = threading.Event()

    @property
    def state(self) -> str:
        with self._lock:
            return self._state

    @property
    def error_message(self) -> str | None:
        with self._lock:
            return self._error_message

    @property
    def joint_readings(self) -> list[dict]:
        with self._lock:
            return list(self._joint_readings)

    def _set_state(self, state: str, error: str | None = None) -> None:
        with self._lock:
            self._state = state
            if error:
                self._error_message = error

    def start(self) -> None:
        """Start calibration: connect to the bus and determine if calibration exists."""
        if self._state not in (STATE_IDLE, STATE_COMPLETE, STATE_ERROR):
            raise RuntimeError(f"Cannot start calibration in state '{self._state}'")

        self._set_state(STATE_IDLE)
        with self._lock:
            self._error_message = None
            self._joint_readings = []
            self._choice = None

        try:
            # Create and connect the bus directly (no robot wrapper — avoids input() calls)
            self._bus = FeetechMotorsBus(
                port=self.port,
                motors=SO101_MOTORS.copy(),
            )
            self._bus.connect()
            logger.info(f"Motor bus connected on {self.port}")
        except Exception as exc:
            self._set_state(STATE_ERROR, f"Failed to connect to motor bus: {exc}")
            raise

        # Check if calibration file exists on disk
        calibration_dir = Path(self.calibration_dir) if self.calibration_dir else self._get_default_calibration_dir()
        calibration_fpath = calibration_dir / f"{self.robot_id}.json"
        has_calibration = calibration_fpath.is_file()
        self._set_state(STATE_AWAITING_CHOICE)

        if not has_calibration:
            # No existing calibration — skip choice, go directly to calibration
            logger.info("No existing calibration found. Starting fresh calibration.")
            self._begin_fresh_calibration()

    def advance(self, choice: str | None = None) -> dict:
        """Advance to the next calibration step.

        Args:
            choice: For awaiting_calibration_choice state: "use_existing" or "run"

        Returns:
            Dict with state and message.
        """
        current_state = self.state

        if current_state == STATE_AWAITING_CHOICE:
            if choice == "run":
                self._begin_fresh_calibration()
                return {"state": self.state, "message": "Running new calibration. Move all joints to the middle of their range, then click Confirm."}
            else:
                # Use existing calibration
                return self._apply_existing_calibration()

        elif current_state == STATE_AWAITING_MIDDLE:
            return self._confirm_middle_position()

        elif current_state == STATE_AWAITING_RANGE:
            return self._confirm_range_of_motion()

        else:
            raise RuntimeError(f"Cannot advance in state '{current_state}'")

    def _apply_existing_calibration(self) -> dict:
        """Write existing calibration from file to motors."""
        try:
            if self._bus is None:
                raise RuntimeError("Bus not connected")

            # Load calibration from the standard lerobot path
            from pathlib import Path
            import draccus

            calibration_dir = Path(self.calibration_dir) if self.calibration_dir else self._get_default_calibration_dir()
            calibration_fpath = calibration_dir / f"{self.robot_id}.json"

            if not calibration_fpath.is_file():
                self._set_state(STATE_ERROR, "No calibration file found")
                return {"state": STATE_ERROR, "message": "No calibration file found. Run a new calibration."}

            with open(calibration_fpath) as f:
                calibration = draccus.load(dict[str, MotorCalibration], f)

            self._bus.write_calibration(calibration)
            logger.info(f"Wrote existing calibration from {calibration_fpath} to motors")

            self._cleanup_bus()
            self._set_state(STATE_COMPLETE)
            return {"state": STATE_COMPLETE, "message": "Existing calibration file applied successfully."}
        except Exception as exc:
            self._set_state(STATE_ERROR, str(exc))
            self._cleanup_bus()
            return {"state": STATE_ERROR, "message": f"Failed to apply calibration: {exc}"}

    def _begin_fresh_calibration(self) -> None:
        """Start fresh calibration: disable torque and wait for middle position."""
        try:
            if self._bus is None:
                raise RuntimeError("Bus not connected")

            self._bus.disable_torque()
            for motor in self._bus.motors:
                self._bus.write("Operating_Mode", motor, OperatingMode.POSITION.value)

            self._set_state(STATE_AWAITING_MIDDLE)
            # Start reading positions immediately so UI shows joint readings
            self._start_position_reader()
        except Exception as exc:
            self._set_state(STATE_ERROR, str(exc))
            self._cleanup_bus()

    def _confirm_middle_position(self) -> dict:
        """User confirmed middle position — compute homing offsets."""
        try:
            if self._bus is None:
                raise RuntimeError("Bus not connected")

            # Stop the position reader temporarily
            self._stop_position_reader()

            # Compute homing offsets at the current (middle) position
            self._homing_offsets = self._bus.set_half_turn_homings()
            logger.info(f"Homing offsets computed: {self._homing_offsets}")

            self._set_state(STATE_AWAITING_RANGE)
            # Restart position reader to show live range tracking
            self._start_position_reader()

            return {"state": STATE_AWAITING_RANGE, "message": "Middle position confirmed. Now move each joint slowly through its full range of motion, then click Confirm."}
        except Exception as exc:
            self._set_state(STATE_ERROR, str(exc))
            self._cleanup_bus()
            return {"state": STATE_ERROR, "message": f"Failed at middle position: {exc}"}

    def _confirm_range_of_motion(self) -> dict:
        """User confirmed range of motion — finalize calibration."""
        try:
            if self._bus is None:
                raise RuntimeError("Bus not connected")

            # Stop recording
            self._stop_position_reader()

            # Validate that ranges were actually recorded
            if not self._range_mins or not self._range_maxes:
                self._set_state(STATE_ERROR, "No range data recorded")
                self._cleanup_bus()
                return {"state": STATE_ERROR, "message": "No range of motion data was recorded. Please try again."}

            # Check for motors with same min/max
            same_min_max = [m for m in self._range_mins if self._range_mins[m] == self._range_maxes[m]]
            if same_min_max:
                self._set_state(STATE_ERROR, f"Motors {same_min_max} have same min and max")
                self._cleanup_bus()
                return {"state": STATE_ERROR, "message": f"Motors {same_min_max} were not moved. Please try again and move each joint."}

            # Set wrist_roll to full range (it's a continuous motor)
            self._range_mins[FULL_TURN_MOTOR] = 0
            self._range_maxes[FULL_TURN_MOTOR] = 4095

            # Build calibration dict
            calibration: dict[str, MotorCalibration] = {}
            for motor, m in self._bus.motors.items():
                calibration[motor] = MotorCalibration(
                    id=m.id,
                    drive_mode=0,
                    homing_offset=self._homing_offsets[motor],
                    range_min=self._range_mins[motor],
                    range_max=self._range_maxes[motor],
                )

            # Write to motors
            self._bus.write_calibration(calibration)

            # Save calibration file
            self._save_calibration(calibration)

            logger.info("Motor calibration completed and saved")
            self._cleanup_bus()
            self._set_state(STATE_COMPLETE)
            return {"state": STATE_COMPLETE, "message": "Calibration complete. Calibration files written successfully."}
        except Exception as exc:
            self._set_state(STATE_ERROR, str(exc))
            self._cleanup_bus()
            return {"state": STATE_ERROR, "message": f"Failed to complete calibration: {exc}"}

    def _start_position_reader(self) -> None:
        """Start a background thread that continuously reads joint positions."""
        self._stop_recording.clear()
        self._range_mins: dict[str, int] = {}
        self._range_maxes: dict[str, int] = {}

        # Keep existing range data if resuming (awaiting_range state)
        if self.state == STATE_AWAITING_RANGE and hasattr(self, '_range_mins'):
            pass  # Keep existing data

        self._recording_thread = threading.Thread(
            target=self._position_reader_loop,
            daemon=True,
        )
        self._recording_thread.start()

    def _stop_position_reader(self) -> None:
        """Stop the position reader thread."""
        self._stop_recording.set()
        if self._recording_thread and self._recording_thread.is_alive():
            self._recording_thread.join(timeout=3)
        self._recording_thread = None

    def _position_reader_loop(self) -> None:
        """Background loop: read motor positions and update joint readings cache."""
        try:
            if self._bus is None:
                return

            motor_names = [m for m in self._bus.motors if m != FULL_TURN_MOTOR]

            # Initialize range tracking from first read
            positions = self._bus.sync_read("Present_Position", motor_names, normalize=False)
            if not self._range_mins:
                self._range_mins = positions.copy()
                self._range_maxes = positions.copy()

            while not self._stop_recording.is_set():
                try:
                    positions = self._bus.sync_read("Present_Position", motor_names, normalize=False)
                except Exception:
                    break

                # Update min/max ranges
                for motor in motor_names:
                    if motor in positions:
                        val = positions[motor]
                        self._range_mins[motor] = min(val, self._range_mins.get(motor, val))
                        self._range_maxes[motor] = max(val, self._range_maxes.get(motor, val))

                # Update joint readings for the frontend
                readings = []
                for motor in motor_names:
                    if motor in positions:
                        readings.append({
                            "name": motor,
                            "min": self._range_mins.get(motor, 0),
                            "pos": positions[motor],
                            "max": self._range_maxes.get(motor, 0),
                        })

                with self._lock:
                    self._joint_readings = readings

                time.sleep(0.1)  # ~10 Hz position updates

        except Exception as exc:
            logger.warning(f"Position reader error: {exc}")

    def _save_calibration(self, calibration: dict) -> None:
        """Save calibration to the standard lerobot path (JSON format)."""
        import draccus

        calibration_dir = Path(self.calibration_dir) if self.calibration_dir else self._get_default_calibration_dir()
        calibration_dir.mkdir(parents=True, exist_ok=True)
        fpath = calibration_dir / f"{self.robot_id}.json"

        with open(fpath, "w") as f, draccus.config_type("json"):
            draccus.dump(calibration, f, indent=4)
        logger.info(f"Calibration saved to {fpath}")

    def _get_default_calibration_dir(self):
        """Get the default lerobot calibration directory (matches SO101Follower.name = 'so_follower')."""
        return Path.home() / ".cache" / "huggingface" / "lerobot" / "calibration" / "robots" / "so_follower"

    def _cleanup_bus(self) -> None:
        """Disconnect the bus gracefully."""
        self._stop_position_reader()
        if self._bus is not None:
            try:
                self._bus.disconnect()
            except Exception as exc:
                logger.warning(f"Error disconnecting bus: {exc}")
            self._bus = None

    def cleanup(self) -> None:
        """Full cleanup — call when aborting or resetting."""
        self._cleanup_bus()
        self._set_state(STATE_IDLE)
        with self._lock:
            self._joint_readings = []
            self._error_message = None
