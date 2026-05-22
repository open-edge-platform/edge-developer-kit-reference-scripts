# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 
import time

import requests
from pymycobot.mycobot import MyCobot


class RoboticArm:
    def __init__(self, type: str = 'm5',
                 port: str ='/dev/ttyACM0', 
                 speed: int =100, 
                 movement_mode: int = 1,
                 sleep_time: int = 1.8, 
                 baud_rate: int = 115200,
                 ip_address: str = "0.0.0.0",
                 ip_port: int = 8080
                 ) -> None:
        self.type = type
        self.port = port
        self.speed = speed
        self.movement_mode=movement_mode
        self.sleep_time=sleep_time
        self.baud_rate = baud_rate
        self.ip_address = ip_address
        self.ip_port = ip_port
        self.mc = None
        self.connect()
        """
        Initializes the RoboticArm object with the specified type, port, speed, movement mode, 
        sleep time, and baud rate for controlling the robotic arm.

        Args:
            type (str): The type or model of the robotic arm (default is 'm5').
            port (str): The serial port for robotic arm communication (default is '/dev/ttyACM0').
            speed (int): The movement speed of the robotic arm (default is 100).
            movement_mode (int): The movement mode (default is 1).
            sleep_time (float): Time in seconds to wait between movements (default is 1.8).
            baud_rate (int): The baud rate for serial communication (default is 115200).
        """

    def connect(self):
        """
        Establish a connection to the MyCobot robotic arm.

        This method initializes the MyCobot instance using the specified port
        and baud rate. If the connection is successful, it prints a confirmation
        message; otherwise, it catches exceptions and prints an error message.

        Raises:
            Exception: If there is a failure in connecting to the MyCobot device.
        """

        try:
            self.mc = MyCobot(self.port, self.baud_rate)
            print(f"Connected to MyCobot on {self.port} at {self.baud_rate} baud.")
            self.mc.set_fresh_mode(0)
        except Exception as e:
            print(f"Failed to connect to MyCobot: {e}")

    def get_location(self) -> None:
        """
        Retrieve and display the current angles and coordinates of the robotic arm.

        This method continuously prompts the user to either print the current
        angles and coordinates or exit the loop. It displays the information
        obtained from the MyCobot instance until the user chooses to exit.

        Note:
            Press '1' to get data, '0' to exit.
        """

        self.mc.release_all_servos()
        while True:
            state = int(input("Press 1 for data or 0 to exit: "))
            if state:
                print(f"Angles: {self.mc.get_angles()}")
            else:
                break

    def move(self, **kwargs) -> None:
        """
        Move the robotic arm to specified coordinates or angles.

        This method takes either 'coordinates' or 'angles' as keyword arguments.
        It sends the specified coordinates or angles to the MyCobot instance,
        applying a defined speed and sleeping for a specified time between each
        movement.

        Args:
            **kwargs: Dictionary containing either:
                - 'coordinates': A list of coordinates to move to.
                - 'angles': A list of angles to set.

        Raises:
            ValueError: If neither 'coordinates' nor 'angles' are provided.
        """        
        if list(kwargs.keys())[0] == 'coordinates':
            for coords in list(kwargs.values())[0]:
                if self.type == "m5":
                    self.mc.send_coords(coords=coords, speed=self.speed)
                    time.sleep(self.sleep_time)
                elif self.type == "pi":
                    self.trigger_move(coords=coords)
                    time.sleep(self.sleep_time)
        
        elif list(kwargs.keys())[0] == 'angles':
            for angles in list(kwargs.values())[0]:
                if self.type == "m5":
                    self.mc.send_angles(angles=angles, speed=self.speed)
                    time.sleep(self.sleep_time)
                elif self.type == "pi":
                    self.trigger_move(angles=angles)
                    time.sleep(self.sleep_time)
        
        else:
            print("Only 'coordinates' or 'angles' are accepted.")

    def control_gripper(self, state) -> None:
        """
        Control the state of the robotic arm's gripper.

        This method sets the gripper state to either open or closed based on the
        provided state. The operation is applied with a defined speed.

        Args:
            state (int): The desired state of the gripper, where '0' is open and
                        '1' is closed.

        Note:
            The method also pauses for a specified time after setting the gripper state.
        """

        self.mc.set_gripper_state(state, speed=self.speed)
        time.sleep(self.sleep_time)

    def set_location(self) -> None:
        """
        Release all servos and focus on each servo for calibration.

        This method releases all servos and prompts the user to indicate when
        they have finished moving the robotic arm. Once confirmed, it focuses
        each servo in sequence for calibration purposes.

        Note:
            The user must enter '1' to confirm the completion of the movement.
        """
        
        self.mc.release_all_servos()
        complete = int(input("Enter 1 if you've done moving the robotic arm: "))
        if complete:
            for i in range (1, 7):
                self.mc.focus_servo(i)
                time.sleep(self.sleep_time)


if __name__ == '__main__':
    robot = RoboticArm()
    robot.get_location()
    