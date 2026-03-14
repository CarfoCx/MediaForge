@echo off
echo ============================================
echo   MediaForge — Building Full Installer
echo   (Includes Python, PyTorch, CUDA, ffmpeg)
echo   This will take 15-30 minutes
echo ============================================
echo.
npm run build:full
echo.
echo Build complete! Installer is in the dist/ folder.
pause
