@echo off
echo === MediaForge — Slim Build (Windows) ===
echo This bundles ffmpeg only. Python + AI deps are auto-installed on first launch.
echo Build size will be ~100 MB.
echo.

npm run build:slim:win
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo.
echo === Build complete! Check dist\ for the installer. ===
pause
