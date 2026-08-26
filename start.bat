@echo off
REM DZ POS PRO - Windows batch launcher
REM Starts the backend server and opens the app in the browser.

setlocal
set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%backend"

if not exist "%BACKEND_DIR%" (
    echo Backend folder not found at: %BACKEND_DIR%
    pause
    exit /b 1
)

cd /d "%BACKEND_DIR%"

REM Read PORT from .env (default 3001)
set "PORT=3001"
if exist .env (
    for /f "tokens=1,* delims==" %%a in (.env) do (
        if "%%a"=="PORT" set "PORT=%%b"
    )
)

REM Install deps if missing
if not exist node_modules (
    echo Installing dependencies (first run only)...
    call npm install
)

echo Starting DZ POS PRO on http://localhost:%PORT% ...
start "DZ POS PRO Server" cmd /c "npm run dev"

timeout /t 4 /nobreak >nul

start "" "http://localhost:%PORT%"

echo.
echo Server is running in a separate window. Close that window to stop it.
endlocal
