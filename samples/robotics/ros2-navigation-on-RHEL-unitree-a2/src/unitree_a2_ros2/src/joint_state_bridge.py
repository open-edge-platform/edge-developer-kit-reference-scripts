#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import importlib
from typing import Any, Dict, List, Optional, Type

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import JointState


class JointStateBridge(Node):
    def __init__(self, node_name: str = 'joint_state_bridge', input_mode: str = 'joint_state') -> None:
        super().__init__(node_name)

        self.declare_parameter('input_mode', input_mode)
        self.declare_parameter('input_topic', '/unitree/joint_states')
        self.declare_parameter('input_lowstate_topic', '/lowstate')
        self.declare_parameter('output_topic', '/joint_states')
        self.declare_parameter('joint_name_map', [])
        self.declare_parameter('motor_index_map', '')
        self.declare_parameter('lowstate_msg_type', 'unitree_hg.msg')
        self.declare_parameter('use_now_timestamp', True)
        self.declare_parameter('use_tau_est', True)

        self.input_mode = self.get_parameter('input_mode').get_parameter_value().string_value
        self.input_topic = self.get_parameter('input_topic').get_parameter_value().string_value
        self.input_lowstate_topic = (
            self.get_parameter('input_lowstate_topic').get_parameter_value().string_value
        )
        self.output_topic = self.get_parameter('output_topic').get_parameter_value().string_value
        self.use_now_timestamp = (
            self.get_parameter('use_now_timestamp').get_parameter_value().bool_value
        )
        self.use_tau_est = self.get_parameter('use_tau_est').get_parameter_value().bool_value
        self.lowstate_msg_type = (
            self.get_parameter('lowstate_msg_type').get_parameter_value().string_value
        )

        map_entries = self.get_parameter('joint_name_map').get_parameter_value().string_array_value
        self.joint_name_map = self._parse_joint_map(list(map_entries))
        self.motor_index_map = self._parse_motor_map(self._read_motor_map_param())

        self.pub = self.create_publisher(JointState, self.output_topic, 50)
        self.msg_class: Optional[Type] = None

        if self.input_mode == 'lowstate':
            self.msg_class = self._load_lowstate_msg_type(self.lowstate_msg_type)
            self.sub = self.create_subscription(
                self.msg_class, self.input_lowstate_topic, self._lowstate_cb, 50
            )
            self.get_logger().info(
                f'Bridging lowstate: {self.input_lowstate_topic} -> {self.output_topic}; '
                f'motor mappings: {len(self.motor_index_map)}'
            )
        else:
            self.sub = self.create_subscription(JointState, self.input_topic, self._joint_cb, 50)
            self.get_logger().info(
                f'Bridging JointState: {self.input_topic} -> {self.output_topic}; '
                f'joint mappings: {len(self.joint_name_map)}'
            )

    def _parse_joint_map(self, entries: List[str]) -> Dict[str, str]:
        mapping: Dict[str, str] = {}
        for entry in entries:
            if ':' not in entry:
                self.get_logger().warn(
                    f'Ignoring malformed joint map entry "{entry}"; expected "src:dst".'
                )
                continue
            src, dst = entry.split(':', 1)
            src = src.strip()
            dst = dst.strip()
            if not src or not dst:
                self.get_logger().warn(
                    f'Ignoring malformed joint map entry "{entry}"; empty source/destination.'
                )
                continue
            mapping[src] = dst
        return mapping

    def _read_motor_map_param(self) -> List[str]:
        p = self.get_parameter('motor_index_map').get_parameter_value()
        if p.string_array_value:
            return list(p.string_array_value)
        if p.string_value:
            return [item.strip() for item in p.string_value.split(',') if item.strip()]
        return []

    def _parse_motor_map(self, entries: List[str]) -> Dict[int, str]:
        mapping: Dict[int, str] = {}
        for entry in entries:
            if ':' not in entry:
                self.get_logger().warn(
                    f'Ignoring malformed motor map entry "{entry}"; expected "index:joint_name".'
                )
                continue
            idx_str, joint_name = entry.split(':', 1)
            idx_str = idx_str.strip()
            joint_name = joint_name.strip()
            try:
                mapping[int(idx_str)] = joint_name
            except ValueError:
                self.get_logger().warn(
                    f'Ignoring motor map entry "{entry}"; "{idx_str}" is not an integer.'
                )
        return mapping

    def _load_lowstate_msg_type(self, msg_type_spec: str) -> Type:
        candidates = [
            (msg_type_spec, 'LowState_'),
            (msg_type_spec, 'LowState'),
            ('unitree_hg.msg', 'LowState_'),
            ('unitree_hg.msg', 'LowState'),
        ]
        for module_name, class_name in candidates:
            try:
                module = importlib.import_module(module_name)
                msg_class = getattr(module, class_name)
                self.get_logger().info(f'Loaded LowState message: {module_name}.{class_name}')
                return msg_class
            except (ImportError, AttributeError):
                continue
        raise ImportError(
            f'Could not find LowState message type in {msg_type_spec}. '
            'Tried: LowState_, LowState from unitree_hg.msg variants.'
        )

    def _joint_cb(self, msg: JointState) -> None:
        out = JointState()
        out.name = [self.joint_name_map.get(name, name) for name in msg.name]
        out.position = list(msg.position)
        out.velocity = list(msg.velocity)
        out.effort = list(msg.effort)

        if self.use_now_timestamp:
            out.header.stamp = self.get_clock().now().to_msg()
        else:
            out.header = msg.header

        self.pub.publish(out)

    def _default_joint_names(self) -> List[str]:
        return [
            'FR_hip_joint',
            'FR_thigh_joint',
            'FR_calf_joint',
            'FL_hip_joint',
            'FL_thigh_joint',
            'FL_calf_joint',
            'RR_hip_joint',
            'RR_thigh_joint',
            'RR_calf_joint',
            'RL_hip_joint',
            'RL_thigh_joint',
            'RL_calf_joint',
        ]

    def _lowstate_cb(self, msg: Any) -> None:
        if not hasattr(msg, 'motor_state') or msg.motor_state is None:
            self.get_logger().warn('Received lowstate with no motor_state data; skipping.')
            return

        motor_state = msg.motor_state
        num_motors = min(12, len(motor_state))
        default_names = self._default_joint_names()

        out = JointState()
        out.header.stamp = self.get_clock().now().to_msg()
        out.name = []
        out.position = []
        out.velocity = []
        out.effort = []

        for i in range(num_motors):
            motor = motor_state[i]
            joint_name = self.motor_index_map.get(i, default_names[i] if i < len(default_names) else f'motor_{i}')
            out.name.append(joint_name)
            out.position.append(float(motor.q))
            out.velocity.append(float(motor.dq))
            if self.use_tau_est and hasattr(motor, 'tau_est'):
                out.effort.append(float(motor.tau_est))
            else:
                out.effort.append(0.0)

        self.pub.publish(out)


def main(args=None, node_name: str = 'joint_state_bridge', input_mode: str = 'joint_state') -> None:
    rclpy.init(args=args)
    node = JointStateBridge(node_name=node_name, input_mode=input_mode)
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


def lowstate_main(args=None) -> None:
    main(args=args, node_name='lowstate_bridge', input_mode='lowstate')


if __name__ == '__main__':
    main()
