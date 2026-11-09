@echo off
setlocal enabledelayedexpansion

:: ===============================================================
:: KUNCI PORTABEL FLASHDISK: Selalu kunci lokasi di folder ini
:: ===============================================================
cd /d "%~dp0"

echo ===================================================
echo     AI TTS AUTOMATION STUDIO V1.0 - INSTALLER
echo                 by: Faiz_Fahmi_ID
echo   (Auto-Detect ^& Auto-Download Node.js Portabel)
echo ===================================================
echo.
echo Lokasi Folder Aplikasi : %CD%
echo.

:: ---------------------------------------------------------------
:: 1. DETEKSI NODE.JS (PORTABEL DI FOLDER INI ATAU SISTEM WINDOWS)
:: ---------------------------------------------------------------
echo [1/4] Memeriksa ketersediaan Node.js...

set "NODE_EXE="
set "NPM_CMD="

:: Cek 1: Node.js portabel di dalam folder bin\node ini
if exist "%CD%\bin\node\node.exe" (
    set "NODE_EXE=%CD%\bin\node\node.exe"
    set "NPM_CMD=%CD%\bin\node\npm.cmd"
    set "PATH=%CD%\bin\node;!PATH!"
    echo [OK] Node.js Portabel ditemukan di dalam folder aplikasi: bin\node\
    goto :node_found
)

:: Cek 2: Node.js dari PATH sistem Windows
where node >nul 2>nul
if %errorlevel% equ 0 (
    for /f "tokens=*" %%p in ('where node') do (
        if not defined NODE_EXE set "NODE_EXE=%%p"
    )
    set "NPM_CMD=npm"
    echo [OK] Node.js terdeteksi dari instalasi sistem Windows.
    goto :node_found
)

:: Cek 3: Lokasi standar C:\Program Files\nodejs
if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files\nodejs\node.exe"
    set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
    set "PATH=C:\Program Files\nodejs;!PATH!"
    echo [OK] Node.js terdeteksi di C:\Program Files\nodejs.
    goto :node_found
)

:: ---------------------------------------------------------------
:: NODE.JS TIDAK DITEMUKAN -> UNDUH OTOMATIS KE FOLDER INI SAJA!
:: Tidak keluar ke folder Downloads, tidak keluar ke Temp
:: Disimpan eksklusif di %CD%\bin\node\ (siap untuk Flashdisk)
:: ---------------------------------------------------------------
echo.
echo [INFO] Node.js belum terpasang di komputer ini.
echo Sistem otomatis mengunduh Node.js Portabel (LTS v20.18.0 64-bit)
echo langsung ke dalam folder aplikasi ini: %CD%\bin\node\
echo.
echo (Mohon tunggu beberapa saat, pengunduhan berjalan otomatis tanpa browser)...
echo.

if not exist "%CD%\bin" mkdir "%CD%\bin"

set "NODE_ZIP=%CD%\bin\node_setup.zip"
set "NODE_URL=https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip"

powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference = 'SilentlyContinue'; Write-Host 'Mengunduh paket Node.js LTS...'; (New-Object Net.WebClient).DownloadFile('%NODE_URL%', '%NODE_ZIP%')"
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Gagal mengunduh Node.js otomatis. Periksa koneksi internet Anda.
    pause
    exit /b 1
)

echo Mengekstrak paket Node.js ke dalam folder %CD%\bin\node ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%CD%\bin' -Force"

if exist "%CD%\bin\node-v20.18.0-win-x64" (
    if exist "%CD%\bin\node" rmdir /s /q "%CD%\bin\node"
    ren "%CD%\bin\node-v20.18.0-win-x64" "node"
)

:: Hapus file zip sementara agar bersih
if exist "%NODE_ZIP%" del /f /q "%NODE_ZIP%"

if exist "%CD%\bin\node\node.exe" (
    set "NODE_EXE=%CD%\bin\node\node.exe"
    set "NPM_CMD=%CD%\bin\node\npm.cmd"
    set "PATH=%CD%\bin\node;!PATH!"
    echo [BERHASIL] Node.js Portabel berhasil dipasang rapi di: %CD%\bin\node\
    echo.
) else (
    echo [ERROR] Ekstraksi Node.js portabel gagal.
    pause
    exit /b 1
)

:node_found
for /f "tokens=*" %%v in ('"!NODE_EXE!" -v') do set "NODE_VER=%%v"
echo Versi Node.js aktif : !NODE_VER!
echo.

:: ---------------------------------------------------------------
:: 2. BUAT STRUKTUR FOLDER PENYIMPANAN DI FOLDER INI
:: ---------------------------------------------------------------
echo [2/4] Menyiapkan direktori penyimpanan lokal (storage/)...
if not exist "storage" mkdir storage
if not exist "storage\wav" mkdir storage\wav
if not exist "storage\mp3" mkdir storage\mp3
if not exist "storage\failed" mkdir storage\failed
if not exist "storage\metadata" mkdir storage\metadata
echo [OK] Folder storage/wav, storage/mp3, storage/failed, storage/metadata siap.
echo.

:: ---------------------------------------------------------------
:: 3. CEK FILE .ENV
:: ---------------------------------------------------------------
echo [3/4] Menyiapkan konfigurasi lingkungan (.env)...
if not exist ".env" (
    if exist ".env.example" (
        copy .env.example .env >nul
        echo [OK] Berkas .env dibuat dari .env.example di folder ini.
    )
)
echo [OK] Konfigurasi siap.
echo.

:: ---------------------------------------------------------------
:: 4. INSTALL DEPENDENCIES NPM KE DALAM FOLDER INI
:: ---------------------------------------------------------------
echo [4/4] Memasang dependensi paket ke dalam node_modules...
echo (Paket disimpan rapi di dalam folder aplikasi ini)
set "NPM_CONFIG_LEGACY_PEER_DEPS=true"
call "!NPM_CMD!" install --legacy-peer-deps
if %errorlevel% neq 0 (
    echo [INFO] Mencoba pemasangan ulang dengan mode proteksi dependensi penuh (--force)...
    call "!NPM_CMD!" install --force
)
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Pemasangan dependensi npm mengalami kegagalan.
    echo Pastikan komputer terhubung ke internet dan tidak diblokir firewall/antivirus.
    pause
    exit /b %errorlevel%
)

echo.
echo ===================================================
echo   INSTALASI 100%% SELESAI & TERSIMPAN DI FOLDER INI!
echo                 by: Faiz_Fahmi_ID
echo ===================================================
echo.
echo Seluruh berkas (Node.js portabel, node_modules, storage)
echo tersimpan rapi dan portabel di:
echo %CD%
echo.
echo Langkah selanjutnya:
echo 1. Klik ganda "start.bat" untuk membuka Website Studio otomatis.
echo 2. Buka Chrome ^> chrome://extensions/ ^> Load Unpacked ^> pilih folder "extension".
echo 3. Selesai!
echo.
pause
