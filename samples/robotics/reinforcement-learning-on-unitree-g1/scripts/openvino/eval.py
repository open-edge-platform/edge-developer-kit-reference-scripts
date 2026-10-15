"""Standalone evaluation of a unitree_rl_mjlab tracking (BeyondMimic) policy in MuJoCo.

This script is intentionally *standalone*: it depends only on
``mujoco``, ``numpy``, ``openvino`` and ``onnxruntime-openvino`` (plus the
Python standard library). It does **not** import ``mjlab`` / ``isaaclab`` /
``torch`` so it can be run on a deployment machine with just the exported
policy (``policy.onnx``) and the reference-motion ``.npz`` file.

It reproduces the exact actor observation of the
``Unitree-G1-Tracking-No-State-Estimation`` task (154-dim) and the joint
position action pipeline (29-dim), then closes the loop with a PD controller
on the MuJoCo torque actuators, exactly as the C++ deploy stack does.

Observation layout (154):
    [  0: 58) motion_command      : ref joint_pos(29) + ref joint_vel(29)
    [ 58: 64) motion_anchor_ori_b : torso orientation error (first 2 cols of R)
    [ 64: 67) base_ang_vel        : pelvis IMU gyro (local frame)
    [ 67: 96) joint_pos_rel       : q - default_q
    [ 96:125) joint_vel_rel       : qd
    [125:154) last_action         : previous raw policy output

Action (29): q_target = raw_action * action_scale + default_joint_pos.

Example:
    python scripts/eval.py \\
        --onnx_path logs/rsl_rl/g1_tracking/<run>/policy.onnx \\
        --motion_file src/assets/motions/g1/kongfu_smplx_upright.npz --loop
"""

import os
import sys
import time
import json
import logging
import argparse

import mujoco
import mujoco.viewer
import numpy as np
import openvino as ov
import onnxruntime as ort

logger = logging.getLogger("eval")
logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")

# --------------------------------------------------------------------------- #
# Unitree G1 (29 DoF) constants.
# Order matches the MuJoCo joint/actuator order in scene_g1.xml which is
# identical to the policy joint order used during training and deployment.
# Values taken from the deploy config (params/deploy.yaml).
# --------------------------------------------------------------------------- #
DEFAULT_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "src/assets/robots/unitree_g1/xmls/scene_g1.xml",
)

# fmt: off
DEFAULT_JOINT_POS = np.array([
    -0.1, 0.0, 0.0, 0.3, -0.2, 0.0,           # left leg
    -0.1, 0.0, 0.0, 0.3, -0.2, 0.0,           # right leg
    0.0, 0.0, 0.0,                            # waist (yaw, roll, pitch)
    0.35, 0.18, 0.0, 0.87, 0.0, 0.0, 0.0,     # left arm
    0.35, -0.18, 0.0, 0.87, 0.0, 0.0, 0.0,    # right arm
], dtype=np.float32)

ACTION_SCALE = np.array([
    0.55, 0.35, 0.55, 0.35, 0.44, 0.44,
    0.55, 0.35, 0.55, 0.35, 0.44, 0.44,
    0.55, 0.44, 0.44,
    0.44, 0.44, 0.44, 0.44, 0.44, 0.07, 0.07,
    0.44, 0.44, 0.44, 0.44, 0.44, 0.07, 0.07,
], dtype=np.float32)

STIFFNESS = np.array([
    40.2, 99.1, 40.2, 99.1, 28.5, 28.5,
    40.2, 99.1, 40.2, 99.1, 28.5, 28.5,
    40.2, 28.5, 28.5,
    14.3, 14.3, 14.3, 14.3, 14.3, 16.8, 16.8,
    14.3, 14.3, 14.3, 14.3, 14.3, 16.8, 16.8,
], dtype=np.float32)

DAMPING = np.array([
    2.6, 6.3, 2.6, 6.3, 1.8, 1.8,
    2.6, 6.3, 2.6, 6.3, 1.8, 1.8,
    2.6, 1.8, 1.8,
    0.9, 0.9, 0.9, 0.9, 0.9, 1.1, 1.1,
    0.9, 0.9, 0.9, 0.9, 0.9, 1.1, 1.1,
], dtype=np.float32)
# fmt: on

NUM_DOF = 29
SIM_TIMESTEP = 0.005  # 200 Hz physics
DECIMATION = 4        # policy runs at 50 Hz -> step_dt = 0.02 s
ANCHOR_BODY_NAME = "torso_link"


# --------------------------------------------------------------------------- #
# Quaternion helpers (all quaternions are [w, x, y, z]).
# --------------------------------------------------------------------------- #
def quat_conjugate(q: np.ndarray) -> np.ndarray:
    return np.array([q[0], -q[1], -q[2], -q[3]], dtype=np.float64)


def quat_mul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    w0, x0, y0, z0 = a
    w1, x1, y1, z1 = b
    return np.array([
        w0 * w1 - x0 * x1 - y0 * y1 - z0 * z1,
        w0 * x1 + x0 * w1 + y0 * z1 - z0 * y1,
        w0 * y1 - x0 * z1 + y0 * w1 + z0 * x1,
        w0 * z1 + x0 * y1 - y0 * x1 + z0 * w1,
    ], dtype=np.float64)


def matrix_from_quat(q: np.ndarray) -> np.ndarray:
    w, x, y, z = q / (np.linalg.norm(q) + 1e-12)
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ], dtype=np.float64)


# --------------------------------------------------------------------------- #
# Reference motion loader.
# --------------------------------------------------------------------------- #
class MotionLoader:
    """Loads a reference-motion ``.npz`` produced by ``csv_to_npz.py``.

    Keys used: ``joint_pos`` [T, 29], ``joint_vel`` [T, 29],
    ``body_pos_w`` [T, B, 3], ``body_quat_w`` [T, B, 4] (w, x, y, z), ``fps``.
    Body index 0 is the pelvis (free-base) body.
    """

    def __init__(self, motion_file: str, anchor_body_npz_index: int):
        if not os.path.exists(motion_file):
            raise FileNotFoundError(f"Motion file not found: {motion_file}")
        data = np.load(motion_file)
        self.joint_pos = data["joint_pos"].astype(np.float32)
        self.joint_vel = data["joint_vel"].astype(np.float32)
        self.body_pos_w = data["body_pos_w"].astype(np.float32)
        self.body_quat_w = data["body_quat_w"].astype(np.float32)
        self.fps = (
            float(np.asarray(data["fps"]).reshape(-1)[0]) if "fps" in data.files else 50.0
        )
        self.num_frames = self.joint_pos.shape[0]
        self.anchor_idx = anchor_body_npz_index

        assert self.joint_pos.shape[1] == NUM_DOF, (
            f"Motion has {self.joint_pos.shape[1]} DoF, expected {NUM_DOF}"
        )
        logger.info(
            "Loaded motion '%s': %d frames @ %.1f fps (%.2fs), %d bodies",
            os.path.basename(motion_file), self.num_frames, self.fps,
            self.num_frames / self.fps, self.body_pos_w.shape[1],
        )

    def root_pos(self, frame: int) -> np.ndarray:
        return self.body_pos_w[frame, 0].astype(np.float64)

    def root_quat(self, frame: int) -> np.ndarray:
        return self.body_quat_w[frame, 0].astype(np.float64)

    def anchor_quat(self, frame: int) -> np.ndarray:
        return self.body_quat_w[frame, self.anchor_idx].astype(np.float64)


# --------------------------------------------------------------------------- #
# Policy loading (OpenVINO Execution Provider for ONNX Runtime).
# --------------------------------------------------------------------------- #
def get_available_devices() -> list:
    try:
        devices = ov.Core().available_devices
    except Exception as exc:  # pragma: no cover - openvino runtime issue
        logger.warning("Could not query OpenVINO devices: %s", exc)
        devices = []
    logger.info("Available OpenVINO devices: %s", devices)
    return devices


def load_onnx_policy(onnx_path: str, device: str = "CPU") -> ort.InferenceSession:
    """Load the exported policy with the OpenVINO execution provider."""
    if not os.path.exists(onnx_path):
        raise FileNotFoundError(f"ONNX model file not found at {onnx_path}")

    device = device.upper()
    available = get_available_devices()
    if device not in available:
        logger.warning("Device '%s' not available; falling back to CPU.", device)
        device = "CPU"

    ov_config = {device: {"PERFORMANCE_HINT": "LATENCY"}}
    provider_options = {
        "device_type": device,
        "cache_dir": os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..", "model_cache"
        ),
        "load_config": json.dumps(ov_config),
    }

    providers = [("OpenVINOExecutionProvider", provider_options)]
    try:
        session = ort.InferenceSession(onnx_path, providers=providers)
        if "OpenVINOExecutionProvider" not in session.get_providers():
            raise RuntimeError("OpenVINO EP not active")
    except Exception as exc:
        logger.warning("OpenVINO EP unavailable (%s); using CPU EP.", exc)
        session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])

    logger.info(
        "Loaded policy '%s' (providers=%s)",
        os.path.basename(onnx_path), session.get_providers(),
    )
    return session


# --------------------------------------------------------------------------- #
# MuJoCo environment.
# --------------------------------------------------------------------------- #
def load_mujoco_env(model_path: str):
    model = mujoco.MjModel.from_xml_path(model_path)
    model.opt.timestep = SIM_TIMESTEP
    data = mujoco.MjData(model)
    return model, data


class G1TrackingRunner:
    """Closed-loop policy runner reproducing the training observation/action."""

    def __init__(self, model, data, session, motion: MotionLoader):
        self.model = model
        self.data = data
        self.session = session
        self.motion = motion
        self.input_name = session.get_inputs()[0].name
        self.obs_dim = int(session.get_inputs()[0].shape[-1])

        # Free-joint qpos = [x,y,z, qw,qx,qy,qz]; joints follow at [7:7+29].
        self.qpos_joint_slice = slice(7, 7 + NUM_DOF)
        self.qvel_joint_slice = slice(6, 6 + NUM_DOF)

        self.torso_body_id = mujoco.mj_name2id(
            model, mujoco.mjtObj.mjOBJ_BODY, ANCHOR_BODY_NAME
        )
        self.gyro_adr = self._sensor_adr("imu_gyro")

        self.ctrl_min = model.actuator_ctrlrange[:, 0].copy()
        self.ctrl_max = model.actuator_ctrlrange[:, 1].copy()

        self.last_action = np.zeros(NUM_DOF, dtype=np.float32)
        self.frame = 0

    def _sensor_adr(self, name: str) -> int:
        sid = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_SENSOR, name)
        if sid < 0:
            raise RuntimeError(f"Sensor '{name}' not found in model")
        return self.model.sensor_adr[sid]

    # -- reset -------------------------------------------------------------- #
    def reset(self, frame: int = 0):
        """Reference-state-initialise the robot at ``frame`` of the motion."""
        self.frame = frame
        mujoco.mj_resetData(self.model, self.data)
        self.data.qpos[0:3] = self.motion.root_pos(frame)
        self.data.qpos[3:7] = self.motion.root_quat(frame)
        self.data.qpos[self.qpos_joint_slice] = self.motion.joint_pos[frame]
        self.data.qvel[:] = 0.0
        self.data.qvel[self.qvel_joint_slice] = self.motion.joint_vel[frame]
        self.last_action[:] = 0.0
        mujoco.mj_forward(self.model, self.data)

    # -- observation -------------------------------------------------------- #
    def _motion_anchor_ori_b(self) -> np.ndarray:
        # Relative orientation of the reference torso w.r.t the robot torso,
        # expressed in the robot torso frame (first two columns of R).
        robot_quat = self.data.xquat[self.torso_body_id].astype(np.float64)
        motion_quat = self.motion.anchor_quat(self.frame)
        q_rel = quat_mul(quat_conjugate(robot_quat), motion_quat)
        rot = matrix_from_quat(q_rel)
        return rot[:, :2].reshape(-1).astype(np.float32)

    def build_observation(self) -> np.ndarray:
        motion_command = np.concatenate(
            [self.motion.joint_pos[self.frame], self.motion.joint_vel[self.frame]]
        )
        anchor_ori = self._motion_anchor_ori_b()
        base_ang_vel = self.data.sensordata[
            self.gyro_adr : self.gyro_adr + 3
        ].astype(np.float32)
        joint_pos_rel = (
            self.data.qpos[self.qpos_joint_slice].astype(np.float32) - DEFAULT_JOINT_POS
        )
        joint_vel_rel = self.data.qvel[self.qvel_joint_slice].astype(np.float32)

        obs = np.concatenate([
            motion_command,      # 58
            anchor_ori,          # 6
            base_ang_vel,        # 3
            joint_pos_rel,       # 29
            joint_vel_rel,       # 29
            self.last_action,    # 29
        ]).astype(np.float32)

        if obs.shape[0] != self.obs_dim:
            raise RuntimeError(
                f"Observation dim {obs.shape[0]} != policy input dim {self.obs_dim}"
            )
        return obs

    # -- action ------------------------------------------------------------- #
    def infer(self, obs: np.ndarray) -> np.ndarray:
        action = self.session.run(None, {self.input_name: obs[None, :]})[0]
        return action.reshape(-1).astype(np.float32)

    def apply_action(self, raw_action: np.ndarray):
        """PD control over ``DECIMATION`` physics substeps."""
        self.last_action = raw_action.copy()
        q_target = raw_action * ACTION_SCALE + DEFAULT_JOINT_POS
        for _ in range(DECIMATION):
            q = self.data.qpos[self.qpos_joint_slice]
            qd = self.data.qvel[self.qvel_joint_slice]
            tau = STIFFNESS * (q_target - q) - DAMPING * qd
            self.data.ctrl[:] = np.clip(tau, self.ctrl_min, self.ctrl_max)
            mujoco.mj_step(self.model, self.data)

    # -- convenience -------------------------------------------------------- #
    def step(self):
        obs = self.build_observation()
        action = self.infer(obs)
        self.apply_action(action)
        self.frame += 1

    def is_fallen(self, min_height: float = 0.3) -> bool:
        return bool(self.data.qpos[2] < min_height)


# --------------------------------------------------------------------------- #
# Main loop with the native MuJoCo passive viewer.
# --------------------------------------------------------------------------- #
def run(runner: G1TrackingRunner, loop: bool, real_time: bool):
    step_dt = SIM_TIMESTEP * DECIMATION
    runner.reset(0)
    with mujoco.viewer.launch_passive(runner.model, runner.data) as viewer:
        while viewer.is_running():
            tic = time.perf_counter()

            if runner.frame >= runner.motion.num_frames:
                if loop:
                    logger.info("Motion finished, looping.")
                    runner.reset(0)
                else:
                    logger.info("Motion finished.")
                    break

            runner.step()

            # if runner.is_fallen():
            #     logger.warning("Robot fell (pelvis z=%.2f).", runner.data.qpos[2])
            #     if loop:
            #         runner.reset(0)
            #     else:
            #         break

            viewer.sync()

            if real_time:
                sleep = step_dt - (time.perf_counter() - tic)
                if sleep > 0:
                    time.sleep(sleep)


def main():
    parser = argparse.ArgumentParser(
        description="Standalone MuJoCo evaluation of a G1 tracking ONNX policy."
    )
    parser.add_argument("--onnx_path", type=str, required=True,
                        help="Path to the exported policy ONNX file.")
    parser.add_argument("--motion_file", type=str, required=True,
                        help="Reference-motion .npz (from csv_to_npz.py).")
    parser.add_argument("--model_path", type=str, default=DEFAULT_MODEL_PATH,
                        help="MuJoCo scene XML for the G1.")
    parser.add_argument("--device", type=str, default="CPU",
                        help="OpenVINO device: CPU, GPU or NPU.")
    parser.add_argument("--loop", action="store_true",
                        help="Restart the motion when it ends or the robot falls.")
    parser.add_argument("--no_real_time", action="store_true",
                        help="Run as fast as possible instead of real time.")
    args = parser.parse_args()

    model, data = load_mujoco_env(args.model_path)
    session = load_onnx_policy(args.onnx_path, args.device)

    # npz body index = MuJoCo body id - 1 (world body is id 0 and absent in npz).
    torso_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, ANCHOR_BODY_NAME)
    motion = MotionLoader(args.motion_file, anchor_body_npz_index=torso_id - 1)

    runner = G1TrackingRunner(model, data, session, motion)
    logger.info("Observation dim: %d | Action dim: %d", runner.obs_dim, NUM_DOF)

    run(runner, loop=args.loop, real_time=not args.no_real_time)


if __name__ == "__main__":
    main()
