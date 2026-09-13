@echo off
title DAG-MILE Automated Runner
color 0A

echo =====================================================================
echo           DAG-MILE: Intelligent Dataset Preparation System
echo           5th Sem Minor Project - Production Architecture
echo =====================================================================
echo.

echo [1/3] Starting Python ML Engine on port 8000...
start "DAG-MILE [Python ML Engine :8000]" cmd /k "cd /d D:\DAG_MILE_PROJECT\ml-preprocessing-main\ml-preprocessing-main\backend && py main.py"

echo [2/3] Waiting for Python backend to initialize...
timeout /t 3 /nobreak >nul

echo [3/3] Starting Node.js API Gateway on port 4000...
start "DAG-MILE [Node.js Gateway :4000]" cmd /k "cd /d D:\DAG_MILE_PROJECT\node-gateway && npm run dev"

echo.
echo Waiting for servers to be fully ready...
timeout /t 4 /nobreak >nul

echo Opening DAG-MILE Workspace in browser...
start http://localhost:4000

echo.
echo =====================================================================
echo  System is LIVE!
echo  Public app (login then ML workspace): http://localhost:4000
echo  Python ML engine (internal API only): http://127.0.0.1:8000
echo =====================================================================
echo.
pause
