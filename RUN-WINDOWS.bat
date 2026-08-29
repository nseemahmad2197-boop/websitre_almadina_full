@echo off
title Almadina Express - المدينة إكسبرس
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22 or newer from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing project dependencies for the first time...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed. Please inspect the message above.
    pause
    exit /b 1
  )
)

echo Starting Almadina Express...
echo Open the local address shown below in your browser.
call npm run dev
pause
