# Innodisk - Intel® Core™ Ultra Series 3 processors (Panther Lake-U/H) GMSL BIOS Configuration

This page describes the BIOS configuration steps for the Innodisk platform to enable the IPU7 with GMSL cameras.

> Note: BIOS menus and exact settings vary by platform vendor and camera sensor.

BIOS options are platform-specific. Configure the platform BIOS to enable the IPU7 and the Intel GMSL SERDES ACPI devices as required in the System Agent (SA) Configuration.

1. Enable IPU and NPU device. 
![Enable IPU device](assets/8.jpg)

2. Navigate to MIPI Camera Configuration
![Go to MIPI config](assets/9.jpg)

> Note: Only enable Camera1 for 4 cameras configuration.

3. Enable Camera1 and Camera2 for 8 cameras configuration. 
![cam1 config](assets/10.jpg)

4. In Camera1 menu, apply all the necessary config for MIPI Port 0.
![cam1 config1](assets/11.jpg)
![cam1 config2](assets/12.jpg)
![cam1 config3](assets/13.jpg)

5. In Camera2 menu, apply all the necessary config for MIPI Port 2.
![cam2 config1](assets/14.jpg)
![cam2 config2](assets/15.jpg)

6. Press F4 to save the changes and navigate to the main BIOS menu page to continue.
System will go into reboot state.

## Trademarks

Ubuntu* is a trademark of Canonical Ltd.
