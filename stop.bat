@echo off
setlocal

:: KUNCI PORTABEL FLASHDISK
cd /d "%~dp0"

echo ===================================================
echo     AI TTS AUTOMATION STUDIO V1.0 - STOPPER
echo ===================================================
echo.
echo Menghentikan proses AI TTS Automation Studio yang berjalan di port 3000...

:: Cari PID proses yang mendengarkan di port 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Menutup proses PID: %%a
    taskkill /f /pid %%a >nul 2>nul
)

echo.
echo [OK] Seluruh proses server AI TTS Studio telah dihentikan secara aman.
echo.
pause
