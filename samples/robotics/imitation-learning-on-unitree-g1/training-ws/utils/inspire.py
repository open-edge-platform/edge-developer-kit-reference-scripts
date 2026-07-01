# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sys
import os
import time
import logging
import multiprocessing

import numpy as np
from enum import IntEnum

from inspire_sdkpy import inspire_sdk, inspire_hand_defaut
from unitree_sdk2py.core.channel import ChannelPublisher, ChannelSubscriber, ChannelFactoryInitialize

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

Inspire_Num_Motors = 6

LEFT_HAND_CTRL_TOPIC = "rt/inspire_hand/ctrl/l"
LEFT_HAND_STATUS_TOPIC = "rt/inspire_hand/state/l"
RIGHT_HAND_CTRL_TOPIC = "rt/inspire_hand/ctrl/r"
RIGHT_HAND_STATUS_TOPIC = "rt/inspire_hand/state/r"

# Default open pose: fingers fully extended (1=open, 0=closed)
DEFAULT_THUMB_ANGLE = 0
MIN_FINGER_ANGLE = 460  # Minimum angle to ensure some thumb closure for better grasping
DEFAULT_QPOS_LEFT  = np.array([1, 1, 1, 1, 1, DEFAULT_THUMB_ANGLE], dtype=np.int16)
DEFAULT_QPOS_RIGHT = np.array([1, 1, 1, 1, 1, DEFAULT_THUMB_ANGLE], dtype=np.int16)

def _hand_worker(ip, hand_side, name, network=None, domain_id=0):
    """Module-level worker: runs in a spawned process (no inherited DDS state).
    Initializes DDS, then actively polls the hand via Modbus to push state onto DDS.
    """
    logger.info(f"[Inspire hand {hand_side}] - Initializing at IP: {ip}, network: {network}, domain id: {domain_id}")

    if network:
        ChannelFactoryInitialize(domain_id, network)
    else:
        ChannelFactoryInitialize(domain_id)
    time.sleep(0.5)
    handler = inspire_sdk.ModbusDataHandler(
        network=network, ip=ip, LR=hand_side, device_id=1)
    time.sleep(0.5)
    try:
        while True:
            handler.read()
            time.sleep(0.001)
    except KeyboardInterrupt:
        pass


class InspireHandController:
    def __init__(self, net: str, left_hand_ip: str, right_hand_ip: str, dds_domain_id: int = 0):
        """
        net:            Network interface name (e.g. 'eno1')
        left_hand_ip:   IP of the left Inspire hand (e.g. '192.168.123.210')
        right_hand_ip:  IP of the right Inspire hand (e.g. '192.168.123.211')
        dds_domain_id:  DDS domain ID (default 0)
        """
        print("Initialize InspireHandController...")

        self.network_interface = net
        self.dds_domain_id = dds_domain_id

        self.num_motors = Inspire_Num_Motors

        # Raw int16 state (0=open, 1000=closed, last channel is thumb angle)
        self.left_hand_state_array  = np.array(DEFAULT_QPOS_LEFT,  dtype=np.int16)
        self.right_hand_state_array = np.array(DEFAULT_QPOS_RIGHT, dtype=np.int16)

        # Temperature / torque placeholders (inspire hand does not expose these)
        self.Ltemp = np.zeros((Inspire_Num_Motors, 2), dtype=np.int16)
        self.Rtemp = np.zeros((Inspire_Num_Motors, 2), dtype=np.int16)
        self.Ltau  = np.zeros(Inspire_Num_Motors, dtype=np.int16)
        self.Rtau  = np.zeros(Inspire_Num_Motors, dtype=np.int16)
        self.Lpos  = np.zeros(Inspire_Num_Motors, dtype=np.int16)
        self.Rpos  = np.zeros(Inspire_Num_Motors, dtype=np.int16)

        self._start_hand_processes(left_hand_ip, right_hand_ip)
        self._start_dds_channel_factory()
        self._start_publisher()
        self._start_subscriber()

        self.get_hand_state()
        print(f"[InspireHandController] left_hand_state_array:  {self.left_hand_state_array}")
        print(f"[InspireHandController] right_hand_state_array: {self.right_hand_state_array}")
        self.initialize()

        print("Initialize InspireHandController OK!\n")

    # ------------------------------------------------------------------
    # Internal setup helpers
    # ------------------------------------------------------------------

    def _start_hand_processes(self, left_ip: str, right_ip: str):
        ctx = multiprocessing.get_context('spawn')
        self.process_l = ctx.Process(
            target=_hand_worker,
            args=(left_ip, 'l', "Left Hand", self.network_interface, self.dds_domain_id)
        )
        self.process_r = ctx.Process(
            target=_hand_worker,
            args=(right_ip, 'r', "Right Hand", self.network_interface, self.dds_domain_id)
        )
        self.process_l.start()
        time.sleep(1)
        self.process_r.start()
        time.sleep(1)
        logger.info("Inspire FTP hand processes started.")

    def _start_dds_channel_factory(self):
        try:
            if self.network_interface:
                ChannelFactoryInitialize(self.dds_domain_id, self.network_interface)
            else:
                ChannelFactoryInitialize(self.dds_domain_id)
            logger.info(f"DDS Channel Factory initialized (domain={self.dds_domain_id}, iface={self.network_interface})")
        except Exception as e:
            logger.info(f"DDS Channel Factory already initialized, skipping: {e}")

    def _start_publisher(self):
        self.publ = ChannelPublisher(LEFT_HAND_CTRL_TOPIC,  inspire_sdk.inspire_hand_ctrl)
        self.publ.Init()
        self.pubr = ChannelPublisher(RIGHT_HAND_CTRL_TOPIC, inspire_sdk.inspire_hand_ctrl)
        self.pubr.Init()
        logger.info("Inspire FTP hand publishers initialized.")

    def _start_subscriber(self):
        self.subl = ChannelSubscriber(LEFT_HAND_STATUS_TOPIC,  inspire_sdk.inspire_hand_state)
        self.subl.Init(self._update_left_hand_data, 10)
        self.subr = ChannelSubscriber(RIGHT_HAND_STATUS_TOPIC, inspire_sdk.inspire_hand_state)
        self.subr.Init(self._update_right_hand_data, 10)
        logger.info("Inspire FTP hand subscribers initialized.")

    def _update_left_hand_data(self, data):
        self.left_hand_state_array = np.array(data.angle_act[:Inspire_Num_Motors], dtype=np.int16)

    def _update_right_hand_data(self, data):
        self.right_hand_state_array = np.array(data.angle_act[:Inspire_Num_Motors], dtype=np.int16)

    # ------------------------------------------------------------------
    # Public API  (mirrors Dex3_1_Controller)
    # ------------------------------------------------------------------

    def get_hand_state(self):
        """Return (left, right) hand positions as numpy float arrays normalised to [0, 1]."""
        left_state  = np.array(self.left_hand_state_array,  dtype=np.float32) / 1000.0
        right_state = np.array(self.right_hand_state_array, dtype=np.float32) / 1000.0
        left_state = np.round(np.clip(left_state, 0.0, 1.0), 3)
        right_state = np.round(np.clip(right_state, 0.0, 1.0), 3)

        return left_state, right_state

    def get_hand_all_state(self):
        """Return (Lpos, Rpos, Ltemp, Rtemp, Ltau, Rtau) – temperature and torque are zeros."""
        for idx in range(Inspire_Num_Motors):
            self.Lpos[idx] = self.left_hand_state_array[idx]
            self.Rpos[idx] = self.right_hand_state_array[idx]
        return (
            self.Lpos.copy(), self.Rpos.copy(),
            self.Ltemp.copy(), self.Rtemp.copy(),
            self.Ltau.copy(), self.Rtau.copy(),
        )

    def ctrl_dual_hand(self, left_q_target, right_q_target):
        """Set current left / right hand target positions.

        The server publishes actions in Dex3 radian convention (open=0 rad,
        closed≈±1.74 rad).  Inspire uses an integer range [0=open, 1000=closed].
        This method remaps by taking the absolute radian value and scaling by
        DEX3_MAX_ANGLE (1.0 rad); values above 1.0 rad are clipped to 1000.
        """
        DEX3_MAX_ANGLE = 1.0

        l_raw = np.clip(
            np.abs(np.array(left_q_target,  dtype=float)) / DEX3_MAX_ANGLE * 1000.0,
            0.0, 1000.0
        ).astype(np.int16)
        r_raw = np.clip(
            np.abs(np.array(right_q_target, dtype=float)) / DEX3_MAX_ANGLE * 1000.0,
            0.0, 1000.0
        ).astype(np.int16)

        #  Ensure finger value in the array (0-4) is at least MIN_FINGER_ANGLE to maintain some thumb closure for better grasping, while allowing thumb angle (index 5) to be set independently
        l_raw[:5] = np.maximum(l_raw[:5], MIN_FINGER_ANGLE)
        r_raw[:5] = np.maximum(r_raw[:5], MIN_FINGER_ANGLE)
        l_raw[-1] = DEFAULT_THUMB_ANGLE
        r_raw[-1] = DEFAULT_THUMB_ANGLE
        
        l_cmd = inspire_hand_defaut.get_inspire_hand_ctrl()
        l_cmd.angle_set = list(l_raw)
        l_cmd.mode = 0b0001

        r_cmd = inspire_hand_defaut.get_inspire_hand_ctrl()
        r_cmd.angle_set = list(r_raw)
        r_cmd.mode = 0b0001

        self.publ.Write(l_cmd)
        if hasattr(self, 'pubr'):
            self.pubr.Write(r_cmd)

    def initialize(self):
        """Send default open-hand pose."""
        print("🔧 Initializing hands with default open pose...")
        self.ctrl_dual_hand(DEFAULT_QPOS_LEFT, DEFAULT_QPOS_RIGHT)

    def cleanup(self):
        for attr in ("process_l", "process_r"):
            proc = getattr(self, attr, None)
            if proc is not None and proc.is_alive():
                proc.terminate()
                proc.join(timeout=2)
        logger.info("Inspire FTP hand processes cleaned up.")

    def close(self):
        """Alias for cleanup() for API consistency."""
        self.cleanup()

    def __del__(self):
        self.cleanup()


# ------------------------------------------------------------------
# Joint index enumerations
# ------------------------------------------------------------------

class InspireLeft_JointIndex(IntEnum):
    kLeftHandIndex0  = 0
    kLeftHandIndex1  = 1
    kLeftHandMiddle0 = 2
    kLeftHandMiddle1 = 3
    kLeftHandPinky   = 4
    kLeftHandThumb   = 5

class InspireRight_JointIndex(IntEnum):
    kRightHandIndex0  = 0
    kRightHandIndex1  = 1
    kRightHandMiddle0 = 2
    kRightHandMiddle1 = 3
    kRightHandPinky   = 4
    kRightHandThumb   = 5


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--net',           type=str, default='eno1',             help='Network interface.')
    parser.add_argument('--left_ip',       type=str, default='192.168.123.210',  help='Left hand IP address.')
    parser.add_argument('--right_ip',      type=str, default='192.168.123.211',  help='Right hand IP address.')
    parser.add_argument('--domain_id',     type=int, default=0,                  help='DDS domain ID.')
    args = parser.parse_args()

    print("🧪 Testing InspireHandController...")
    hand_ctrl = InspireHandController(
        net=args.net,
        left_hand_ip=args.left_ip,
        right_hand_ip=args.right_ip,
        dds_domain_id=args.domain_id,
    )

    print("🎯 Running open/close test sequence...")
    try:
        for step in range(20):
            # Simulate dex3-style radian values: 0 (open) → 1.74 (closed)
            t = step / 20.0 * 1.74
            cmd = np.array([0.1, 0.1, 0.1, 0.1, 0.1, 0], dtype=float)  # open
            hand_ctrl.ctrl_dual_hand(cmd, cmd)
            time.sleep(5)
            cmd = np.array([1, 1, 1, 1, 1, 0], dtype=float)  # closed
            hand_ctrl.ctrl_dual_hand(cmd, cmd)
            time.sleep(5)
            left_state, right_state = hand_ctrl.get_hand_state()
            print(f"Step {step:2d}: Left {[f'{v:.3f}' for v in left_state]}  Right {[f'{v:.3f}' for v in right_state]}")
            time.sleep(0.1)
    finally:
        hand_ctrl.cleanup()

    print("✅ Test completed!")
