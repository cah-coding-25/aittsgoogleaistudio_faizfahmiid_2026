@echo off
title Smart Auto Upload to GitHub - by: Faiz_Fahmi_ID
color 0a
:MenuUtama
cls
echo ===================================================
echo           SMART AUTO UPLOAD TO GITHUB
echo                by: Faiz_Fahmi_ID
echo ===================================================
echo.

:: 1. CEK GIT DI LAPTOP/PC TERLEBIH DAHULU
where git >nul 2>&1
if not errorlevel 1 (
echo [OK] Git terdeteksi di Laptop/PC!
goto SelesaiCekGit
)

:: 2. JIKA GIT DI LAPTOP/PC TIDAK ADA, CARI GIT PORTABLE DI FLASHDISK D-Z
echo [INFO] Git tidak ditemukan di Laptop/PC.
echo [INFO] Mencari Git Portable di Flashdisk...

set "GIT_PATH="
for %%i in (D E F G H I J K L M N O P Q R S T U V W X Y Z) do (
if exist "%%i:\GitPortable\cmd\git.exe" set "GIT_PATH=%%i:\GitPortable\cmd"
if exist "%%i:\Aplikasi Portable\GitPortable\cmd\git.exe" set "GIT_PATH=%%i:\Aplikasi Portable\GitPortable\cmd"
)

if "%GIT_PATH%"=="" (
echo [ERROR] Git tidak ditemukan di Laptop/PC maupun Flashdisk!
pause
exit
)

set "PATH=%GIT_PATH%;%PATH%"
echo [OK] Git Portable Aktif!

:SelesaiCekGit
echo.

:: 3. Inisialisasi Git Lokal
if not exist ".git" git init

:: 4. Membaca Identitas Otomatis (Jika sudah ada data asli)
if exist "akun.txt" (
for /f "tokens=1,2 delims==" %%a in (akun.txt) do (
if "%%a"=="email" set "MY_EMAIL=%%b"
if "%%a"=="username" set "MY_NAME=%%b"
)
)

:: Jika ternyata file akun.txt kosong/rusak, dipaksa isi ulang agar tidak error
if "%MY_EMAIL%"=="" set "MY_EMAIL="
if "%MY_NAME%"=="" set "MY_NAME="

if not "%MY_EMAIL%"=="" if not "%MY_NAME%"=="" (
echo [OK] Identitas Akun Terdeteksi Otomatis!
echo Email    : %MY_EMAIL%
echo Username : %MY_NAME%
goto InputLinkLangsung
)

echo === KONFIGURASI AWAL IDENTITAS GITHUB ===
set /p INPUT_EMAIL="Masukkan Email GitHub Anda   : "
set /p INPUT_NAME="Masukkan Username GitHub Anda: "

echo email=%INPUT_EMAIL% > akun.txt
echo username=%INPUT_NAME% >> akun.txt

set "MY_EMAIL=%INPUT_EMAIL%"
set "MY_NAME=%INPUT_NAME%"

echo [OK] Identitas disimpan permanen di akun.txt!

:InputLinkLangsung
echo.

git config --global user.email "%MY_EMAIL%"
git config --global user.name "%MY_NAME%"

:: 5. INPUT LINK LANGSUNG (Selalu Ditanyakan Setiap Klik, Tanpa Membaca repo.txt)
set /p REPO_URL="Masukkan URL/Link Github Baru Anda: "

:: Menghilangkan spasi tak terlihat di link
set "REPO_URL=%REPO_URL: =%"

git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%

:: 6. Proses Pengemasan dan Pengunggahan Data
echo.
echo [PROSES] Menambahkan file proyek...
git add -A --force

echo [PROSES] Membuat catatan versi...
git commit -m "Upload otomatis via Script Pintar Faiz"

echo [PROSES] Mengunci jalur branch utama...
git branch -M main

echo [PROSES] Mendorong file menuju GitHub Server...
git push -u origin main --force

echo.
echo ===================================================
echo [PROSES BERSID-BERSID] Menetralkan Kredensial Laptop...
cmdkey /delete:LegacyGeneric:target=git:https://github.com >nul 2>&1
echo [OK] Sisa data login berhasil dihapus dari laptop!
echo ===================================================
echo.
echo =============================================
echo      SUKSES TERUNGGAH! - BY: FAIZ_FAHMI_ID
echo =============================================
pause