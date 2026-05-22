import os
import time
import logging
import numpy as np

from lerobot.robots.so_follower import SO101Follower, SO101FollowerConfig

logger = logging.getLogger(__name__)


class RobotKinematics:
    """Robot kinematics using placo library for forward and inverse kinematics."""

    def __init__(
        self,
        urdf_path: str,
        target_frame_name: str = "gripper_frame_link",
        joint_names: list[str] | None = None,
    ):
        """
        Initialize placo-based kinematics solver.

        Args:
            urdf_path (str): Path to the robot URDF file
            target_frame_name (str): Name of the end-effector frame in the URDF
            joint_names (list[str] | None): List of joint names to use for the kinematics solver
        """
        try:
            import placo
        except ImportError as e:
            raise ImportError(
                "placo is required for RobotKinematics. "
                "Please install the optional dependencies of `kinematics` in the package."
            ) from e

        self.robot = placo.RobotWrapper(urdf_path)
        self.solver = placo.KinematicsSolver(self.robot)
        self.solver.mask_fbase(True)  # Fix the base

        self.target_frame_name = target_frame_name

        # Set joint names
        self.joint_names = list(self.robot.joint_names()
                                ) if joint_names is None else joint_names

        # Initialize frame task for IK
        self.tip_frame = self.solver.add_frame_task(
            self.target_frame_name, np.eye(4))

    def forward_kinematics(self, joint_pos_deg: np.ndarray) -> np.ndarray:
        """
        Compute forward kinematics for given joint configuration given the target frame name in the constructor.

        Args:
            joint_pos_deg: Joint positions in degrees (numpy array)

        Returns:
            4x4 transformation matrix of the end-effector pose
        """

        # Convert degrees to radians
        joint_pos_rad = np.deg2rad(joint_pos_deg[: len(self.joint_names)])

        # Update joint positions in placo robot
        for i, joint_name in enumerate(self.joint_names):
            self.robot.set_joint(joint_name, joint_pos_rad[i])

        # Update kinematics
        self.robot.update_kinematics()

        # Get the transformation matrix
        return self.robot.get_T_world_frame(self.target_frame_name)

    def inverse_kinematics(
        self,
        current_joint_pos: np.ndarray,
        desired_ee_pose: np.ndarray,
        position_weight: float = 1.0,
        orientation_weight: float = 0.01,
    ) -> np.ndarray:
        """
        Compute inverse kinematics using placo solver.

        Args:
            current_joint_pos: Current joint positions in degrees (used as initial guess)
            desired_ee_pose: Target end-effector pose as a 4x4 transformation matrix
            position_weight: Weight for position constraint in IK
            orientation_weight: Weight for orientation constraint in IK, set to 0.0 to only constrain position

        Returns:
            Joint positions in degrees that achieve the desired end-effector pose
        """

        # Convert current joint positions to radians for initial guess
        current_joint_rad = np.deg2rad(
            current_joint_pos[: len(self.joint_names)])

        # Set current joint positions as initial guess
        for i, joint_name in enumerate(self.joint_names):
            self.robot.set_joint(joint_name, current_joint_rad[i])

        # Update the target pose for the frame task
        self.tip_frame.T_world_frame = desired_ee_pose

        # Configure the task based on position_only flag
        self.tip_frame.configure(
            self.target_frame_name, "soft", position_weight, orientation_weight)

        # Solve IK
        self.solver.solve(True)
        self.robot.update_kinematics()

        # Extract joint positions
        joint_pos_rad = []
        for joint_name in self.joint_names:
            joint = self.robot.get_joint(joint_name)
            joint_pos_rad.append(joint)

        # Convert back to degrees
        joint_pos_deg = np.rad2deg(joint_pos_rad)

        # Preserve gripper position if present in current_joint_pos
        if len(current_joint_pos) > len(self.joint_names):
            result = np.zeros_like(current_joint_pos)
            result[: len(self.joint_names)] = joint_pos_deg
            result[len(self.joint_names)
                       :] = current_joint_pos[len(self.joint_names):]
            return result
        else:
            return joint_pos_deg


class SO101FollowerArm:
    JOINT_NAME_MAP = {
        '1': 'shoulder_pan.pos',
        '2': 'shoulder_lift.pos',
        '3': 'elbow_flex.pos',
        '4': 'wrist_flex.pos',
        '5': 'wrist_roll.pos',
        '6': 'gripper.pos',
        'shoulder_pan': 'shoulder_pan.pos',
        'shoulder_lift': 'shoulder_lift.pos',
        'elbow_flex': 'elbow_flex.pos',
        'wrist_flex': 'wrist_flex.pos',
        'wrist_roll': 'wrist_roll.pos',
        'gripper': 'gripper.pos',
    }
    R_DOWN = np.array([
        [1, 0, 0],
        [0, 0, 1],
        [0, -1, 0]
    ])
    FIXED_WRIST_ROLL = -1.27
    DEFAULT_LOCATION = {
        "home": {
            'shoulder_pan.pos': 0.0,
            'shoulder_lift.pos': -32.747252747252745,
            'elbow_flex.pos': 35.34065934065934,
            'wrist_flex.pos': 90.0,
            'wrist_roll.pos': 0.0,
            'gripper.pos': 15.0
        },
        "container": {
            'shoulder_pan.pos': -63.529411764705884,
            'shoulder_lift.pos': -33.61309274024339,
            'elbow_flex.pos': 27.26453357368183,
            'wrist_flex.pos': 92.80575539568346,
            'wrist_roll.pos': -0.6732263076126372,
            'gripper.pos': 15.0
        },
        "dock": {
            'shoulder_pan.pos': 2.35294117647058,
            'shoulder_lift.pos': -99.4964330675619,
            'elbow_flex.pos': 99.36908517350159,
            'wrist_flex.pos': 67.4989420228523,
            'wrist_roll.pos': -0.8803728638011421,
            'gripper.pos': 15.0
        }
    }

    def __init__(self, port: str = "/dev/ttyACM0", id: str = "SO101Follower", gripper_threshold: list[float] = [60.0, 15.0]):
        config = SO101FollowerConfig(
            port=port,
            id=id,
        )
        self.robot = SO101Follower(config)
        self.gripper_open_threshold = gripper_threshold[0]
        self.gripper_close_threshold = gripper_threshold[1]
        logger.info(f"Gripper open threshold: {self.gripper_open_threshold}")
        logger.info(f"Gripper close threshold: {self.gripper_close_threshold}")

        self.DEFAULT_LOCATION["home"]["gripper.pos"] = self.gripper_close_threshold
        self.DEFAULT_LOCATION["container"]["gripper.pos"] = self.gripper_close_threshold
        self.DEFAULT_LOCATION["dock"]["gripper.pos"] = self.gripper_close_threshold

        urdf_path = "./platforms/so101/urdf/so101.urdf"
        if not os.path.exists(urdf_path):
            raise FileNotFoundError(
                f"URDF file not found at {urdf_path}. Please ensure the path is correct.")

        self.kinematics = RobotKinematics(
            urdf_path=urdf_path,
            target_frame_name="gripper_frame_link",
            joint_names=[
                'shoulder_pan',
                'shoulder_lift',
                'elbow_flex',
                'wrist_flex',
                'wrist_roll',
                "gripper",
            ]
        )

        try:
            self.robot.connect()
            logger.info("Connected to SO101 Follower robot.")

        except Exception as e:
            print(f"Failed to connect to robot: {e}")
            raise e

    def _make_pose_with_R(self, x: float, y: float, z: float, R: np.ndarray) -> np.ndarray:
        T = np.eye(4)
        T[:3, :3] = R
        T[:3, 3] = [x, y, z]
        return T

    def _get_current_joint_vector(self) -> np.ndarray:
        obs = self.robot.get_observation()
        q = []
        for name in self.kinematics.joint_names:
            key = self.JOINT_NAME_MAP[name]
            q.append(float(obs[key]))
        return np.array(q, dtype=float)

    def _set_gripper(self, target_value: float, duration: float = 1.0):
        obs = self.robot.get_observation()
        current_grip = float(obs.get("gripper.pos", 0.0))
        base_action = {}
        for name in self.JOINT_NAME_MAP.values():
            if name != "gripper.pos":
                base_action[name] = float(obs.get(name, 0.0))

        steps = max(int(duration * 40), 10)
        dt = duration / steps
        for i in range(1, steps + 1):
            alpha = i / steps
            g = (1.0 - alpha) * current_grip + alpha * target_value
            action = dict(base_action)
            action["gripper.pos"] = g
            self.robot.send_action(action)
            time.sleep(dt)

    def get_current_joint_pose(self) -> dict:
        obs = self.robot.get_observation()
        joint_pose = {}
        for name in self.kinematics.joint_names:
            key = self.JOINT_NAME_MAP[name]
            joint_pose[key] = float(obs.get(key, 0.0))
        return joint_pose

    def get_current_ee_pose(self) -> np.ndarray:
        q = self._get_current_joint_vector()
        T = self.kinematics.forward_kinematics(q)
        pos = T[:3, 3]
        logger.info(
            f"Current EE position (frame '{self.kinematics.target_frame_name}'):")
        logger.info(f" x={pos[0]:.4f}m, y={pos[1]:.4f}m, z={pos[2]:.4f}m")
        return T

    def move_to_joint_position(self, target_joints: dict, duration: float = 1.0):
        obs = self.robot.get_observation()
        joint_keys = list(target_joints.keys())

        q_current = np.array([float(obs.get(k, 0.0))
                              for k in joint_keys], dtype=float)
        q_target = np.array([float(target_joints[k])
                            for k in joint_keys], dtype=float)

        steps = max(int(duration * 40), 10)
        dt = duration / steps

        for i in range(1, steps + 1):
            alpha = i / steps
            q = (1.0 - alpha) * q_current + alpha * q_target
            action = {k: float(val) for k, val in zip(joint_keys, q)}
            if "gripper.pos" not in action:
                action["gripper.pos"] = float(obs.get("gripper.pos", 0.0))
            self.robot.send_action(action)
            time.sleep(dt)

    def go_to_pose_with_ik(
        self,
        T_des: np.ndarray,
        duration: float = 2.0,
        position_weight: float = 1.0,
        orientation_weight: float | None = None,
        wrist_roll: float | None = None,
    ):
        current_q = self._get_current_joint_vector()
        T_start = self.kinematics.forward_kinematics(current_q)

        if orientation_weight is None:
            orientation_weight = 0.1 if self.R_DOWN is not None else 0.0

        steps = max(int(duration * 40), 10)
        dt = duration / steps

        q_last = current_q

        for i in range(1, steps + 1):
            alpha = i / steps
            pos_target = (1.0 - alpha) * T_start[:3, 3] + alpha * T_des[:3, 3]
            T_step = T_des.copy()
            T_step[:3, 3] = pos_target

            q_step = self.kinematics.inverse_kinematics(
                current_joint_pos=q_last,
                desired_ee_pose=T_step,
                position_weight=position_weight,
                orientation_weight=orientation_weight,
            )

            if 'wrist_roll' in self.kinematics.joint_names and wrist_roll is not None:
                idx = self.kinematics.joint_names.index('wrist_roll')
                q_step[idx] = wrist_roll

            q_last = q_step
            action = {}
            for name, value in zip(self.kinematics.joint_names, q_last):
                action[self.JOINT_NAME_MAP[name]] = float(value)

            obs = self.robot.get_observation()
            action["gripper.pos"] = float(obs.get("gripper.pos", 0.0))
            self.robot.send_action(action)
            time.sleep(dt)

    def move_relative(
        self,
        x: float,
        y: float,
        z: float,
        duration: float = 2.0,
        position_weight: float = 1.0,
        orientation_weight: float | None = None,
        wrist_roll: float | None = None,
    ):
        current_q = self._get_current_joint_vector()
        T_current = self.kinematics.forward_kinematics(current_q)
        R_current = T_current[:3, :3]
        T_target = self._make_pose_with_R(x, y, z, R_current)
        self.go_to_pose_with_ik(
            T_target, duration=duration,
            position_weight=position_weight,
            orientation_weight=orientation_weight,
            wrist_roll=wrist_roll
        )

    def open_gripper(self, duration: float = 2.0):
        open_value = self.gripper_open_threshold
        print(f"Opening gripper to {open_value}")
        self._set_gripper(target_value=open_value, duration=duration)

    def close_gripper(self, duration: float = 2.0):
        close_value = self.gripper_close_threshold
        print(f"Closing gripper to {close_value}")
        self._set_gripper(target_value=close_value, duration=duration)

    def disconnect(self):
        try:
            self.move_to_joint_position(self.DEFAULT_LOCATION["home"])
        except Exception as exc:
            logger.warning(f"Could not move to home before disconnect: {exc}")
        self.robot.disconnect()
        logger.info("Disconnected from SO101 Follower robot.")
