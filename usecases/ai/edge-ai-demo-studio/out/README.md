# Edge AI Demo Studio

Edge AI Demo Studio is a modern toolkit for deploying, managing, and serving AI models on edge platforms. It features a web-based UI for device and workload management, and is optimized for Intel hardware and edge environments.

## Getting Started

### For Linux Users

Before running Edge AI Demo Studio, you need to install system dependencies and configure AppArmor:

1. **Install System Dependencies**

   Open a terminal and navigate to the Edge AI Demo Studio directory, then run:

   ```bash
   sudo ./install_dependencies.sh
   ```

   This will install required system packages including Intel GPU support and other dependencies.

2. **Run Edge AI Demo Studio**

   After the dependencies are installed, you can start the application using one of these options:

   **Desktop Application (Recommended):**

   First, configure AppArmor to allow unprivileged user namespaces:

   ```bash
   sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
   ```

   Then start the application:

   - **Option 1:** Right-click the `EdgeAiStudio` file and select "Run as a program"
   - **Option 2:** Run from terminal: `./EdgeAiStudio`

   **Web Services Only (Browser-based):**

   If you prefer to run only the web services and access them through your browser:

   a. **Set up the project**

   ```bash
   ./setup.sh
   ```

   This will install all necessary dependencies and configure the frontend and worker services.

   b. **Start the web server**

   ```bash
   ./run_web.sh
   ```

   This will start the web server and make it accessible at `http://localhost:8080`

### For Windows Users

Windows users have multiple options for running Edge AI Demo Studio:

#### Option 1: Desktop Application (Recommended)

No additional setup is required. Simply:

1. Navigate to the Edge AI Demo Studio folder
2. Double-click the `EdgeAiStudio.bat` file to launch the application

#### Option 2: Web Services Only (Browser-based)

If you prefer to run only the web services and access them through your browser:

1. **Set up the project**

   Open PowerShell as Administrator, navigate to the Edge AI Demo Studio directory, then run:

   ```powershell
   .\setup.ps1
   ```

   This will install all necessary dependencies and configure the frontend and worker services.

2. **Start the web server**
   ```powershell
   .\run_web.ps1
   ```
   This will start the web server and make it accessible at `http://localhost:8080`

**Alternative command-line options:**

- Skip specific components: `.\setup.ps1 -SkipWorkers` or `.\setup.ps1 --skip-workers`
- For compatibility with bash syntax: `.\setup.ps1 --skip-frontend --skip-workers`

## System Requirements

### Linux

- **Operating System:** Ubuntu 24.04 LTS (other Linux distributions may work, but are not officially supported)
- **Hardware:** Intel hardware recommended for optimal performance
- **Other:** System dependencies will be installed by the `install_dependencies.sh` script

### Windows

- **Operating System:** Windows 11 24H2 (other versions may work, but this is the validated version)
- **Hardware:** Intel hardware recommended for optimal performance

## Troubleshooting

### Linux Issues

**Q: The install_dependencies.sh script fails**

- Make sure you're running it with `sudo`
- Ensure your system is up to date: `sudo apt update && sudo apt upgrade`

**Q: The desktop application won't start**

- Check that all dependencies were installed successfully
- Make sure AppArmor is configured: `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`
- Try right-clicking the `EdgeAiStudio` file and selecting "Run as a program"
- If that doesn't work, try running from terminal to see error messages: `./EdgeAiStudio`

**Q: Desktop application crashes or shows namespace errors**

- This is usually due to AppArmor restrictions. Run: `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`
- To make the setting permanent, add `kernel.apparmor_restrict_unprivileged_userns=0` to `/etc/sysctl.conf`

### Web Services Issues

**Q: Web server won't start or shows port errors**

- Make sure port 8080 is not already in use by another application
- Check if the setup completed successfully by running `./setup.sh` again
- Try accessing the web interface at `http://localhost:8080` after starting the server

**Q: Worker services fail to start**

- Ensure Python dependencies are installed correctly
- Check that the required AI models are available
- Review the specific worker logs in the `logs/` directory
- Make sure you're using the correct model IDs when starting workers

**Q: Web interface loads but AI features don't work**

- Check that the necessary worker services are running
- Verify that the worker services are accessible on their respective ports
- Check the browser console for any connection errors

### Windows Issues

**Q: Windows blocks the executable**

- Right-click the .exe file and select "Run anyway" or add an exception to Windows Defender
- This is normal for unsigned applications

**Q: Desktop application won't start**

- Make sure you have the latest Windows updates installed
- Try running the `EdgeAiStudio.bat` file instead of the .exe directly
- Try running as administrator
- Check that all dependencies were installed if you ran the setup

**Q: PowerShell execution policy prevents running scripts**

- Open PowerShell as Administrator and run: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`
- Or run scripts with: `powershell.exe -ExecutionPolicy Bypass -File .\setup.ps1`

**Q: Web server won't start on Windows**

- Make sure port 8080 is not already in use by another application
- Check Windows Firewall settings to ensure the port is not blocked
- Run `.\setup.ps1` again to ensure all dependencies are correctly installed
- Try accessing the web interface at `http://localhost:8080` after starting the server

**Q: Node.js or npm not found errors**

- The packaged application includes its own Node.js runtime
- Make sure you're running the scripts from the correct Edge AI Demo Studio directory
- Check that the `edge-ai-demo-studio-win32-x64\resources\thirdparty\node\node.exe` file exists
