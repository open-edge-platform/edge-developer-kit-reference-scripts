@echo off
REM Copyright (C) 2026 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

setlocal enabledelayedexpansion

:main
if "%1"=="" (
    echo Please use standalone_embed.bat restart^|start^|stop^|delete
    exit /b 1
)

if "%1"=="restart" (
    call :stop
    call :start
) else if "%1"=="start" (
    call :start
) else if "%1"=="stop" (
    call :stop
) else if "%1"=="delete" (
    call :delete
) else (
    echo Unknown command.
    echo Please use standalone_embed.bat restart^|start^|stop^|delete
    exit /b 1
)
goto :eof

:run_embed
(
echo listen-client-urls: http://127.0.0.1:2379
echo advertise-client-urls: http://127.0.0.1:2379
echo quota-backend-bytes: 4294967296
echo auto-compaction-mode: revision
echo auto-compaction-retention: '1000'
) > embedEtcd.yaml

(
echo # Extra config to override default milvus.yaml
) > user.yaml

if not exist "embedEtcd.yaml" (
    echo embedEtcd.yaml file does not exist. Please try to create it in the current directory.
    exit /b 1
)
if not exist "user.yaml" (
    echo user.yaml file does not exist. Please try to create it in the current directory.
    exit /b 1
)

docker run -d ^
    --name milvus-standalone ^
    --security-opt seccomp:unconfined ^
    -e ETCD_USE_EMBED=true ^
    -e ETCD_DATA_DIR=/var/lib/milvus/etcd ^
    -e ETCD_CONFIG_PATH=/milvus/configs/embedEtcd.yaml ^
    -e COMMON_STORAGETYPE=local ^
    -e DEPLOY_MODE=STANDALONE ^
    -v "%cd%\volumes\milvus:/var/lib/milvus" ^
    -v "%cd%\embedEtcd.yaml:/milvus/configs/embedEtcd.yaml" ^
    -v "%cd%\user.yaml:/milvus/configs/user.yaml" ^
    -p 127.0.0.1:19530:19530 ^
    -p 127.0.0.1:9091:9091 ^
    -p 127.0.0.1:2379:2379 ^
    --health-cmd="curl -f http://localhost:9091/healthz" ^
    --health-interval=30s ^
    --health-start-period=90s ^
    --health-timeout=20s ^
    --health-retries=3 ^
    milvusdb/milvus:v3.0.3 ^
    milvus run standalone >nul
if %errorlevel% neq 0 (
    echo Failed to start Milvus container.
    exit /b 1
)

goto :eof

:wait_for_milvus_running
echo Wait for Milvus Starting...
set "wait_attempts=0"
set "running="
if not defined MILVUS_HEALTH_MAX_ATTEMPTS set "MILVUS_HEALTH_MAX_ATTEMPTS=120"
:wait_loop
for /f "tokens=*" %%A in ('docker ps ^| findstr "milvus-standalone" ^| findstr /c:"(healthy)"') do set running=1
if "!running!"=="1" (
    echo Start successfully.
    echo To change the default Milvus configuration, edit user.yaml and restart the service.
    exit /b 0
)
set /a wait_attempts+=1
if !wait_attempts! geq !MILVUS_HEALTH_MAX_ATTEMPTS! (
    echo Milvus did not become healthy after !MILVUS_HEALTH_MAX_ATTEMPTS! attempts.
    exit /b 1
)
timeout /t 1 >nul
goto wait_loop

:start
for /f "tokens=*" %%A in ('docker ps ^| findstr "milvus-standalone" ^| findstr /c:"(healthy)"') do (
    echo Milvus is running.
    exit /b 0
)

for /f "tokens=*" %%A in ('docker ps -a ^| findstr "milvus-standalone"') do set container_exists=1
if defined container_exists (
    docker start milvus-standalone >nul
) else (
    call :run_embed
)

if %errorlevel% neq 0 (
    echo Start failed.
    exit /b 1
)

call :wait_for_milvus_running
if errorlevel 1 exit /b 1
exit /b 0

:stop
docker stop milvus-standalone >nul
if %errorlevel% neq 0 (
    echo Stop failed.
    exit /b 1
)
echo Stop successfully.
goto :eof

:delete_container
for /f "tokens=*" %%A in ('docker ps ^| findstr "milvus-standalone"') do (
    echo Please stop Milvus service before delete.
    exit /b 1
)
docker rm milvus-standalone >nul
if %errorlevel% neq 0 (
    echo Delete Milvus container failed.
    exit /b 1
)
echo Delete Milvus container successfully.
goto :eof

:delete
set /p check="Please confirm if you'd like to proceed with the delete. This operation will delete the container and data. Confirm with 'y' for yes or 'n' for no. > "
if /i "%check%"=="y" (
    call :delete_container
    if errorlevel 1 exit /b 1
    rmdir /s /q "%cd%\volumes"
    del /q embedEtcd.yaml
    del /q user.yaml
    echo Delete successfully.
) else (
    echo Exit delete
    exit /b 0
)
goto :eof



:EOF
