@echo off
setlocal enabledelayedexpansion

:: ===============================================================
:: KUNCI PORTABEL FLASHDISK: Selalu kunci working directory ke folder aplikasi
:: ===============================================================
cd /d "%~dp0"

echo ===================================================
echo     AI TTS AUTOMATION STUDIO V1.0 - RUNNER
echo                 by: Faiz_Fahmi_ID
echo ===================================================
echo.
echo Lokasi Folder Aktif: %CD%
echo.

set "NODE_EXE="
set "NPM_CMD="

:: 1. Cek Node.js Portabel di dalam folder bin\node
if exist "%CD%\bin\node\node.exe" (
    set "NODE_EXE=%CD%\bin\node\node.exe"
    set "NPM_CMD=%CD%\bin\node\npm.cmd"
    set "PATH=%CD%\bin\node;!PATH!"
    echo [OK] Menggunakan Node.js Portabel dari folder: bin\node\
    goto :node_ready
)

:: 2. Cek Node.js dari PATH Windows
where node >nul 2>nul
if %errorlevel% equ 0 (
    for /f "tokens=*" %%p in ('where node') do (
        if not defined NODE_EXE set "NODE_EXE=%%p"
    )
    set "NPM_CMD=npm"
    echo [OK] Menggunakan Node.js dari sistem Windows.
    goto :node_ready
)

:: 3. Cek lokasi standar Program Files
if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files\nodejs\node.exe"
    set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
    set "PATH=C:\Program Files\nodejs;!PATH!"
    echo [OK] Menggunakan Node.js dari C:\Program Files\nodejs.
    goto :node_ready
)

:: 4. Jika belum ada Node.js sama sekali, jalankan install.bat otomatis
echo [PERHATIAN] Node.js belum ditemukan di folder ini atau sistem.
echo Memulai pemasangan Node.js portabel otomatis via install.bat...
echo.
call "%~dp0install.bat"

if exist "%CD%\bin\node\node.exe" (
    set "NODE_EXE=%CD%\bin\node\node.exe"
    set "NPM_CMD=%CD%\bin\node\npm.cmd"
    set "PATH=%CD%\bin\node;!PATH!"
    goto :node_ready
) else (
    echo [ERROR] Pemasangan otomatis gagal. Pastikan koneksi internet aktif.
    pause
    exit /b 1
)

:node_ready
:: Pastikan node_modules sudah ada di folder ini
if not exist "node_modules" (
    echo [INFO] node_modules belum ditemukan di folder ini.
    echo Menjalankan pemasangan dependensi lokal otomatis...
    set "NPM_CONFIG_LEGACY_PEER_DEPS=true"
    call "!NPM_CMD!" install --legacy-peer-deps
)

echo.
echo ===================================================
echo   DASHBOARD WEBSITE : http://localhost:3000
echo   BACKEND API       : http://localhost:3000/api
echo   AUTHOR            : Faiz_Fahmi_ID
echo ===================================================
echo.
echo Membuka browser Chrome dan menjalankan server lokal...
echo Server sedang aktif. Tekan CTRL + C di jendela ini untuk berhenti.
echo.

:: Buka browser otomatis ke http://localhost:3000
start "" http://localhost:3000

:: Jalankan server aplikasi
call "!NPM_CMD!" run dev
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Terjadi kegagalan saat menjalankan server.
    pause
)
