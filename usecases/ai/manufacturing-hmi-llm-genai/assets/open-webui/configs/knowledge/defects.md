<!-- Copyright (C) 2025 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0  -->
*   **Missing M2B Switch**
    
    *   **Issue**: The M2B switch is either not present or detached from its intended location on the board.
        
    *   **Possible Causes**:
        
        *   Manufacturing defects (such as missing components in the assembly).
            
        *   Handling issues (such as accidental dislodging or loss during assembly).
            
        *   Circuit design errors (schematic may be outdated or incorrect).
            
    *   **Resolution**:
        
        1.  Inspect the designated M2B switch location on the PCB for any visible damage to the solder pads or traces.
            
        2.  If the solder pads are intact, solder a new M2B switch, ensuring it’s oriented correctly (if it’s polarized, pay attention to the marking).
            
        3.  Use a multimeter to check for continuity across the switch’s terminals.
            
        4.  Test the functionality of the circuit to confirm proper operation, possibly by checking its response in the circuit test environment.
            
*   **Missing Capacitor**
    
    *   **Issue**: A capacitor is absent in a position where it should be present according to the schematic.
        
    *   **Possible Causes**:
        
        *   Component failure in manufacturing (missing during assembly).
            
        *   Incorrect or incomplete schematic design.
            
        *   Mishandling during transport or testing.
            
    *   **Resolution**:
        
        1.  Identify the correct value of the missing capacitor from the PCB schematic (capacity, voltage rating, and type).
            
        2.  Install a replacement capacitor with the proper rating, ensuring it is placed in the correct orientation if it is polarized.
            
        3.  Check the circuit with an oscilloscope to ensure proper filtering or smoothing functions are working.
            
        4.  Verify performance by testing the power supply or signal stability.
            
*   **Inverted Small Capacitor**
    
    *   **Issue**: A small capacitor has been soldered incorrectly, causing incorrect polarity or alignment in the circuit.
        
    *   **Possible Causes**:
        
        *   Error in placement during assembly.
            
        *   Lack of clear polarity markings, leading to incorrect placement.
            
        *   Human error during soldering or inspection.
            
    *   **Resolution**:
        
        1.  Desolder the misplaced capacitor using a rework station, ensuring the components are not damaged.
            
        2.  Rotate the capacitor to match the correct polarity markings or position on the PCB.
            
        3.  Resolder the capacitor carefully, ensuring clean joints with no solder bridges.
            
        4.  Inspect and test the circuit to ensure proper behavior, checking for the expected output in the affected part of the system.
            
        5.  If necessary, check the ESR (Equivalent Series Resistance) of the capacitor to ensure it is within specifications.
            
*   **Missing M1B Switch**
    
    *   **Issue**: The M1B switch is either missing or dislodged from its designated position on the board.
        
    *   **Possible Causes**:
        
        *   Assembly oversight or defective soldering leading to the switch falling off.
            
        *   Mechanical stress or mishandling during testing.
            
        *   Component shortage or misplacement during the manufacturing process.
            
    *   **Resolution**:
        
        1.  Locate the designated M1B switch position on the board and inspect for missing or damaged solder pads.
            
        2.  Install a correctly rated M1B switch in the proper orientation, ensuring it is aligned correctly with the PCB design.
            
        3.  Once installed, check the functionality of the switch by testing the circuit behavior in normal operating conditions.
            
        4.  Run a continuity test to ensure the switch is making a proper electrical connection when actuated.
            
*   **Inverted Capacitor**
    
    *   **Issue**: A capacitor has been installed with incorrect polarity or orientation.
        
    *   **Possible Causes**:
        
        *   Capacitor was soldered in reverse, especially if it's an electrolytic or tantalum type, which are polarized.
            
        *   A misinterpretation of the PCB markings or component leads.
            
        *   Quick assembly without proper inspection.
            
    *   **Resolution**:
        
        1.  Heat the solder joints and carefully remove the capacitor using a desoldering pump or braid.
            
        2.  Rotate the capacitor to ensure it is placed according to the correct polarity and the PCB markings.
            
        3.  Re-solder the component in place, ensuring the correct lead placement and secure solder joints.
            
        4.  Verify circuit operation by testing with an oscilloscope, voltage measurements, or functional testing to ensure no abnormal behavior occurs.