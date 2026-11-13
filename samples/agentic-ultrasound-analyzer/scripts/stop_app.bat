@echo off
REM Copyright (C) 2026 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0
setlocal EnableExtensions EnableDelayedExpansion
if not defined BACKEND_SERVER_PORT set "BACKEND_SERVER_PORT=15000"
if not defined BLIP_SERVICE_PORT set "BLIP_SERVICE_PORT=15100"

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=--shutdown"

if /I "%MODE%"=="--status" goto status

echo ============================================================
echo  Agentic Ultrasound Analyzer POC - Process Guard (%MODE%)
echo ============================================================

:: Kill process groups by command line identity.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$k=@(); $self=$PID; $procs=Get-CimInstance Win32_Process; foreach($p in $procs){ if([int]$p.ProcessId -eq [int]$self){ continue }; $cmd=''; if($p.CommandLine){ $cmd = $p.CommandLine.ToLowerInvariant() }; if($cmd.Contains('flask_backend_server.py') -or $cmd.Contains('blip_service.py') -or $cmd.Contains('ovms.exe') -or $cmd.Contains(' ovms ')){ try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $k += [int]$p.ProcessId } catch {} } }; $k = @($k | Sort-Object -Unique); if($k.Count -gt 0){ Write-Host ('Killed process IDs: ' + ($k -join ', ')) } else { Write-Host 'Killed process IDs: none' }"
if errorlevel 1 (
  echo [WARN] Process command-line cleanup encountered an issue.
)

:: Kill any listeners on known app ports to prevent duplicates.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=@([int]$env:BACKEND_SERVER_PORT,[int]$env:BLIP_SERVICE_PORT,8000,9000); $ids=@(); foreach($port in $ports){ $conns=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; foreach($c in $conns){ if($c.OwningProcess){ $ids += [int]$c.OwningProcess } } }; $ids=@($ids | Sort-Object -Unique); if($ids.Count -gt 0){ foreach($id in $ids){ try { Stop-Process -Id $id -Force -ErrorAction Stop } catch {} }; Write-Host ('Killed listener process IDs: ' + ($ids -join ', ')) } else { Write-Host 'Killed listener process IDs: none' }"
if errorlevel 1 (
  echo [WARN] Port-listener cleanup encountered an issue.
)

if /I "%MODE%"=="--shutdown" (
  echo Stopping Milvus container stack...
  if exist "%ROOT_DIR%\milvus\standalone.bat" (
    call "%ROOT_DIR%\milvus\standalone.bat" stop >nul 2>&1
    if errorlevel 1 (
      echo [WARN] standalone.bat stop returned non-zero. Continuing.
    ) else (
      echo Milvus stop requested.
    )
  ) else (
    echo [WARN] standalone.bat not found. Skipping Milvus stop.
  )
)

echo Process guard complete.
exit /b 0

:status
echo ============================================================
echo  Agentic Ultrasound Analyzer POC - Runtime Status
echo ============================================================
echo.
echo App process candidates (backend/BLIP/OVMS):
powershell -NoProfile -ExecutionPolicy Bypass -Command "$procs=Get-CimInstance Win32_Process; $rows=@(); foreach($p in $procs){ $cmd=''; if($p.CommandLine){ $cmd=$p.CommandLine.ToLowerInvariant() }; if($cmd.Contains('flask_backend_server.py') -or $cmd.Contains('blip_service.py') -or $cmd.Contains('ovms.exe') -or $cmd.Contains(' ovms ')){ $rows += [pscustomobject]@{ ProcessId=$p.ProcessId; Name=$p.Name; CommandLine=$p.CommandLine } } }; if($rows.Count -gt 0){ $rows | Format-Table -AutoSize } else { Write-Host 'none' }"
echo.
echo Port listeners (%BACKEND_SERVER_PORT%/%BLIP_SERVICE_PORT%/8000/9000):
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=@([int]$env:BACKEND_SERVER_PORT,[int]$env:BLIP_SERVICE_PORT,8000,9000); $rows=@(); foreach($port in $ports){ $conns=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; foreach($c in $conns){ $rows += [pscustomobject]@{ LocalPort=$c.LocalPort; OwningProcess=$c.OwningProcess } } }; if($rows.Count -gt 0){ $rows | Sort-Object LocalPort,OwningProcess | Format-Table -AutoSize } else { Write-Host 'none' }"
echo.
echo Milvus container status:
docker ps --filter "name=milvus-standalone" --format "table {{.Names}}\t{{.Status}}" 2>nul
if errorlevel 1 (
  echo Unable to query Docker container status.
)
echo.
echo Status check complete.
exit /b 0