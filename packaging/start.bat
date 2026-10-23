@echo off
rem Starts LightPDF with a local server on Windows: double-click this file.
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node server.mjs
  goto :end
)
where py >nul 2>nul
if %errorlevel%==0 (
  echo Node.js not found, using Python. Press Ctrl+C to stop.
  start "" http://localhost:8080/
  py -3 -m http.server 8080 --bind 127.0.0.1 --directory app
  goto :end
)
echo LightPDF needs Node.js (https://nodejs.org) or Python 3 to run. Install one and try again.
:end
pause
