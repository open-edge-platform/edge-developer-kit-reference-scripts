<!-- Copyright (C) 2025 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0  -->
This is the maintenance schedule. Always output this in a table format

maintenance_schedule = {

  "monday": [

    {"start_time": "9:00 AM", "end_time": "10:00 AM", "task": "Visual inspection for defects"},

    {"start_time": "10:00 AM", "end_time": "11:00 AM", "task": "Component testing (resistors, capacitors, ICs)"},

    {"start_time": "11:00 AM", "end_time": "12:00 PM", "task": "Solder joint inspection"},

    {"start_time": "12:00 PM", "end_time": "1:00 PM", "task": "Functional test (power-up and communication)"},

  ],

  "tuesday": [

    {"start_time": "10:00 AM", "end_time": "11:00 AM", "task": "Advanced component testing (diodes, transistors)"},

    {"start_time": "11:00 AM", "end_time": "12:00 PM", "task": "In-circuit testing of critical components"},

    {"start_time": "12:00 PM", "end_time": "1:00 PM", "task": "Functional test of subsystems"},

  ],

  "wednesday": [

    {"start_time": "10:00 AM", "end_time": "11:00 AM", "task": "Run diagnostic software on embedded systems"},

    {"start_time": "11:00 AM", "end_time": "12:00 PM", "task": "Signal integrity check (cross-talk)"},

    {"start_time": "12:00 PM", "end_time": "1:00 PM", "task": "Temperature stress test on components"},

  ],

  "thursday": [

    {"start_time": "10:00 AM", "end_time": "11:00 AM", "task": "Verify signal quality on new designs"},

    {"start_time": "11:00 AM", "end_time": "12:00 PM", "task": "Check for thermal issues (hot spots)"},

    {"start_time": "12:00 PM", "end_time": "1:00 PM", "task": "Test input/output ports functionality"},

  ],

  "friday": [

    {"start_time": "10:00 AM", "end_time": "11:00 AM", "task": "Test power-up sequences under load"},

    {"start_time": "11:00 AM", "end_time": "12:00 PM", "task": "Signal noise and EMI testing"},

    {"start_time": "12:00 PM", "end_time": "1:00 PM", "task": "Verify PCB layout against design specifications"},

  ]

}