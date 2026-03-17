# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 
import time
import serial

class ConveyorBelt:
    def __init__(self, port: str = "/dev/ttyACM1", baud_rate: int = 115200):
        """
        Initializes the ConveyorBelt object by setting up the serial port and baud rate.
        
        Args:
            port (str): The serial port for the conveyor belt communication (default is "/dev/ttyACM1").
            baud_rate (int): The baud rate for the serial communication (default is 115200).
        """
        self.port = port
        self.baud_rate = baud_rate
        self.ser = None
        self.open_serial()

    def open_serial(self):
        """
        Open and return a serial connection to the Arduino.
        """
        self.ser = serial.Serial(self.port, self.baud_rate, timeout=0)
        # Give the Arduino a moment to reset after opening the port
        time.sleep(2)

    def move(self, steps):
        """
        Send a MOVE command with relative steps to the Arduino, wait for 'DONE'.
        """
        if not self.ser:
            raise ConnectionError("Serial connection is not open.")
        
        command = f"MOVE {steps}\n"
        self.ser.write(command.encode('utf-8'))
        
        # Wait for the 'DONE' response
        while True:
            line = self.ser.readline().decode('utf-8', errors='replace').strip()
            if line == "DONE":
                time.sleep(1)
                return

    def close_serial(self):
        """
        Close the serial connection.
        """
        if self.ser:
            self.ser.close()


if __name__ == "__main__":
    conveyor = ConveyorBelt()
    conveyor.open_serial()
    conveyor.move(1000)
    conveyor.close_serial()
