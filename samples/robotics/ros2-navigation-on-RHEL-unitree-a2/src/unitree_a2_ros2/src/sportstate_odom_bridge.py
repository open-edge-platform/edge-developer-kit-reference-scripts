#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import importlib
from typing import Any, Optional, Type

import rclpy
from geometry_msgs.msg import TransformStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node
from sensor_msgs.msg import Imu
from tf2_ros import TransformBroadcaster


class SportStateOdomBridge(Node):
    def __init__(self) -> None:
        super().__init__('sportstate_odom_bridge')

        self.declare_parameter('input_sportstate_topic', '/rt/sportmodestate')
        self.declare_parameter('sportstate_msg_module', 'unitree_go.msg')
        self.declare_parameter('output_odom_topic', '/odom')
        self.declare_parameter('output_imu_topic', '/imu/data')
        self.declare_parameter('odom_frame', 'odom')
        self.declare_parameter('base_frame', 'base_link')
        self.declare_parameter('imu_frame', 'imu_link')
        self.declare_parameter('publish_tf', True)
        self.declare_parameter('publish_odom', True)
        self.declare_parameter('publish_imu', True)

        self.input_topic = (
            self.get_parameter('input_sportstate_topic').get_parameter_value().string_value
        )
        self.msg_module = (
            self.get_parameter('sportstate_msg_module').get_parameter_value().string_value
        )
        self.output_odom_topic = (
            self.get_parameter('output_odom_topic').get_parameter_value().string_value
        )
        self.output_imu_topic = (
            self.get_parameter('output_imu_topic').get_parameter_value().string_value
        )
        self.odom_frame = self.get_parameter('odom_frame').get_parameter_value().string_value
        self.base_frame = self.get_parameter('base_frame').get_parameter_value().string_value
        self.imu_frame = self.get_parameter('imu_frame').get_parameter_value().string_value
        self.publish_tf = self.get_parameter('publish_tf').get_parameter_value().bool_value
        self.publish_odom = self.get_parameter('publish_odom').get_parameter_value().bool_value
        self.publish_imu = self.get_parameter('publish_imu').get_parameter_value().bool_value

        self.msg_class: Optional[Type] = None
        self.tf_broadcaster = TransformBroadcaster(self)
        self.odom_pub = self.create_publisher(Odometry, self.output_odom_topic, 20)
        self.imu_pub = self.create_publisher(Imu, self.output_imu_topic, 20)

        self.msg_class = self._load_sportstate_msg_type(self.msg_module)
        self.sub = self.create_subscription(
            self.msg_class, self.input_topic, self._cb_sportstate, 20
        )

        self.get_logger().info(
            f'Bridging sport state {self.input_topic} -> {self.output_odom_topic} '
            f'and TF {self.odom_frame}->{self.base_frame}; '
            f'IMU -> {self.output_imu_topic} (frame={self.imu_frame})'
        )

    def _load_sportstate_msg_type(self, module_hint: str) -> Type:
        candidates = [
            (module_hint, 'SportModeState_'),
            (module_hint, 'SportModeState'),
            ('unitree_go.msg', 'SportModeState_'),
            ('unitree_go.msg', 'SportModeState'),
            ('unitree_hg.msg', 'SportModeState_'),
            ('unitree_hg.msg', 'SportModeState'),
        ]

        for module_name, class_name in candidates:
            try:
                module = importlib.import_module(module_name)
                msg_class = getattr(module, class_name)
                self.get_logger().info(f'Loaded sport state type: {module_name}.{class_name}')
                return msg_class
            except (ImportError, AttributeError):
                continue

        raise ImportError(
            'Could not import SportModeState message type. '
            'Set parameter sportstate_msg_module to your Unitree message module.'
        )

    def _extract_seq3(self, obj: Any, field_name: str) -> Optional[Any]:
        if not hasattr(obj, field_name):
            return None
        val = getattr(obj, field_name)
        if callable(val):
            val = val()
        return val

    def _extract_seq4(self, obj: Any, field_name: str) -> Optional[Any]:
        if not hasattr(obj, field_name):
            return None
        val = getattr(obj, field_name)
        if callable(val):
            val = val()
        return val

    def _cb_sportstate(self, msg: Any) -> None:
        pos = self._extract_seq3(msg, 'position')
        vel = self._extract_seq3(msg, 'velocity')
        imu_state = getattr(msg, 'imu_state', None)
        if callable(imu_state):
            imu_state = imu_state()

        if pos is None or len(pos) < 3:
            self.get_logger().warn('Sport state has no valid position[3]; skipping frame.')
            return

        if vel is None or len(vel) < 3:
            vel = [0.0, 0.0, 0.0]

        q = self._extract_seq4(imu_state, 'quaternion') if imu_state is not None else None
        gyro = self._extract_seq3(imu_state, 'gyroscope') if imu_state is not None else None
        accel = self._extract_seq3(imu_state, 'accelerometer') if imu_state is not None else None

        if q is None or len(q) < 4:
            q = [1.0, 0.0, 0.0, 0.0]
        if gyro is None or len(gyro) < 3:
            gyro = [0.0, 0.0, 0.0]
        if accel is None or len(accel) < 3:
            accel = [0.0, 0.0, 0.0]

        self._publish_pose_and_tf(
            float(pos[0]),
            float(pos[1]),
            float(pos[2]),
            float(q[0]),
            float(q[1]),
            float(q[2]),
            float(q[3]),
            float(vel[0]),
            float(vel[1]),
            float(vel[2]),
            float(gyro[0]),
            float(gyro[1]),
            float(gyro[2]),
            float(accel[0]),
            float(accel[1]),
            float(accel[2]),
        )

    def _publish_pose_and_tf(
        self,
        px: float,
        py: float,
        pz: float,
        qw: float,
        qx: float,
        qy: float,
        qz: float,
        vx: float,
        vy: float,
        vz: float,
        wx: float,
        wy: float,
        wz: float,
        ax: float,
        ay: float,
        az: float,
    ) -> None:
        stamp = self.get_clock().now().to_msg()

        if self.publish_odom:
            odom = Odometry()
            odom.header.stamp = stamp
            odom.header.frame_id = self.odom_frame
            odom.child_frame_id = self.base_frame

            odom.pose.pose.position.x = px
            odom.pose.pose.position.y = py
            odom.pose.pose.position.z = pz

            odom.pose.pose.orientation.w = qw
            odom.pose.pose.orientation.x = qx
            odom.pose.pose.orientation.y = qy
            odom.pose.pose.orientation.z = qz

            odom.twist.twist.linear.x = vx
            odom.twist.twist.linear.y = vy
            odom.twist.twist.linear.z = vz

            self.odom_pub.publish(odom)

        if self.publish_imu:
            imu = Imu()
            imu.header.stamp = stamp
            imu.header.frame_id = self.imu_frame

            imu.orientation.w = qw
            imu.orientation.x = qx
            imu.orientation.y = qy
            imu.orientation.z = qz

            imu.angular_velocity.x = wx
            imu.angular_velocity.y = wy
            imu.angular_velocity.z = wz

            imu.linear_acceleration.x = ax
            imu.linear_acceleration.y = ay
            imu.linear_acceleration.z = az

            self.imu_pub.publish(imu)

        if self.publish_tf:
            t = TransformStamped()
            t.header.stamp = stamp
            t.header.frame_id = self.odom_frame
            t.child_frame_id = self.base_frame

            t.transform.translation.x = px
            t.transform.translation.y = py
            t.transform.translation.z = pz

            t.transform.rotation.w = qw
            t.transform.rotation.x = qx
            t.transform.rotation.y = qy
            t.transform.rotation.z = qz

            self.tf_broadcaster.sendTransform(t)


def main(args=None) -> None:
    rclpy.init(args=args)
    node = SportStateOdomBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
