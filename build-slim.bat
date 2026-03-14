@echo off
echo ============================================
echo   MediaForge — Building Slim Installer
echo   (Auto-downloads Python on first run)
echo ============================================
echo.
npm run build:slim
echo.
echo Build complete! Installer is in the dist/ folder.
pause
