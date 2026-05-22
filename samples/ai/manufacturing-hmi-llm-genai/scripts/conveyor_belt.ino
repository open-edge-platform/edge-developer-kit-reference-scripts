// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

#include <AccelStepper.h>
// Define stepper motor connections and motor interface type
#define dirPin 2
#define stepPin 5
#define motorInterfaceType 1

AccelStepper stepper = AccelStepper(motorInterfaceType, stepPin, dirPin);
void setup() {
  Serial.begin(115200);
  stepper.setMaxSpeed(1000);
  stepper.setAcceleration(1000);
}
void loop() {
  // Check if there is any serial input available
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim(); // Remove trailing newline/spaces
    // Expect commands like: MOVE 2000 or MOVE -1000
    if (command.startsWith("MOVE")) {
      // Find the space character to isolate the step value
      int spaceIndex = command.indexOf(' ');
      if (spaceIndex > 0) {
        // Extract the steps as a substring
        String stepsStr = command.substring(spaceIndex + 1);
        long steps = stepsStr.toInt();
        // Command the stepper to move relative to current position
        stepper.move(steps);  // This sets a new target = current position + steps
        // runToPosition() blocks until the new target is reached
        stepper.runToPosition();
        // Once done, send feedback to Python
        Serial.println("DONE");
      }
    }
  }
}
