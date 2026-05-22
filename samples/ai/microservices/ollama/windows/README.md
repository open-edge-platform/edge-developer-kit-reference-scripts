# Ollama on Windows

## Setup
1. If you are setting up Ollama for Lunar lake and Meteor Lake system, please open the `install.cmd` file and change the line `EXTRA_INDEX_URL` to the following.
* Lunar Lake: https://pytorch-extension.intel.com/release-whl/stable/lnl/cn/
* Meteor Lake: https://pytorch-extension.intel.com/release-whl/stable/mtl/cn/
```bash
# Example for Lunar Lake
EXTRA_INDEX_URL=https://pytorch-extension.intel.com/release-whl/stable/lnl/cn/
```

2. Right click on the `install.cmd` script and click `Run as administrator`

## Run
1. Double click on the `run.cmd` to start Ollama service

2. If the service is successfully launched, you will see `Ollama service running on http://localhost:8012` in the command prompt interface
