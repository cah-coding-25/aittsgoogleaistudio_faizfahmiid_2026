# AI TTS AUTOMATION STUDIO V1.0
### Online Cloud Web Dashboard + Local Chrome Extension (Zero-BAT & Potato-PC Ready)
**Dibuat & Dikembangkan oleh: Faiz_Fahmi_ID**

Sistem otomatisasi profesional untuk menghasilkan file audio suara Text-to-Speech (TTS) berkualitas tinggi menggunakan antarmuka **Google AI Studio** secara berurutan dan otomatis (*One Job at a Time*), mengonversi hasil WAV ke MP3 (192 kbps), serta menyimpannya secara rapi.

> **💡 BISA DIJALANKAN ONLINE (VERCEL / CLOUD) TANPA FILE .BAT!**
> Anda dapat mengunggah repositori ini ke **GitHub** lalu deploy ke **Vercel** atau platform cloud lainnya. Komputer kentang (low-spec PC) Anda **TIDAK PERLU menginstal Node.js** dan **TIDAK PERLU lagi membuka file `.bat`**! Cukup buka link website di Google Chrome dan pasang Ekstensi Chrome lokal yang sangat ringan (&lt; 15MB RAM).

---

## 📋 DAFTAR ISI
1. [Fitur Utama](#fitur-utama)
2. [Arsitektur Sistem (Online Cloud + Local Extension)](#arsitektur-sistem)
3. [Panduan Deploy Online (GitHub + Vercel - Zero BAT)](#panduan-deploy-online-github--vercel---zero-bat)
4. [Langkah Alternatif: Menjalankan Lokal (Bagi Pengembang)](#langkah-alternatif-menjalankan-lokal)
5. [Panduan Pemasangan Chrome Extension](#panduan-pemasangan-chrome-extension)
6. [Cara Menggunakan Aplikasi](#cara-menggunakan-aplikasi)
   - [Membuat Pekerjaan Teks](#1-membuat-pekerjaan-teks)
   - [Import TXT dan CSV](#2-import-txt-dan-csv)
   - [Menghubungkan Ekstensi & Google AI Studio](#3-menghubungkan-ekstensi--google-ai-studio)
   - [Menjalankan Antrean Generasi](#4-menjalankan-antrean-generasi)
   - [Pemutaran Audio & Unduh File](#5-pemutaran-audio--unduh-file)
7. [Struktur Penyimpanan](#struktur-penyimpanan)
8. [Mode Pengujian (Mock Mode)](#mode-pengujian-mock-mode)
9. [Troubleshooting & Solusi Masalah Umum](#troubleshooting--solusi-masalah-umum)

---

## 🚀 FITUR UTAMA
- **Bulk Text Input & Import:** Mendukung input satuan (Single Mode) maupun ratusan teks sekaligus (Bulk Mode), serta import dari format file `.txt` dan `.csv`.
- **Ekstensi Chrome Manifest V3:** Dilengkapi sistem selektor modular berbasis ARIA dan label semantik Google AI Studio dengan *realtime handshake* dan pemeriksa diagnostik DOM.
- **Antrean Terurut (Strict FIFO):** Memproses *One Job at a Time* untuk menghindari benturan eksekusi pada tab AI Studio.
- **Sistem Auto Retry Cerdas:** 3 kali percobaan ulang dengan jeda bertahap (5 detik, 15 detik, 30 detik) bila terjadi kendala jaringan sementara.
- **Audio Processor WAV ke MP3:** Konversi internal bawaan (menggunakan pure JavaScript lamejs / FFmpeg) ke format MP3 192 kbps tanpa memerlukan software converter pihak ketiga atau koneksi internet eksternal.
- **Penyimpanan Lokal & Pemulihan:** Seluruh berkas WAV, MP3, dan status pekerjaan disimpan di komputer. Antrean otomatis pulih jika komputer atau server dimulai ulang.
- **Audio Library Lengkap:** Pemutar audio terintegrasi dengan pemutar waveform, preview WAV/MP3, penggantian nama file, dan tombol unduh sekaligus seluruh MP3 dalam arsip ZIP.

---

## 🏗️ ARSITEKTUR SISTEM
```
[ Website Dashboard (React + Vite) ]
                ↕ (PostMessage / SSE / REST)
[ Backend Local (Express + Audio Processor) ]
                ↕ (HTTP Handshake & Heartbeat)
[ Chrome Extension (Manifest V3 Service Worker) ]
                ↕ (DOM Automation & Blob Extraction)
[ Tab Google AI Studio (https://aistudio.google.com/) ]
```

---

## 💻 PERSYARATAN SISTEM
- **Sistem Operasi:** Windows 10/11, macOS, atau Linux
- **Node.js:** Versi 18.0.0 atau lebih tinggi (disarankan Node.js 20 LTS atau 22)
- **Browser:** Google Chrome (versi 110 atau terbaru)
- **Koneksi Internet:** Untuk membuka Google AI Studio di browser

---

## 📦 LANGKAH INSTALASI

### Pengguna Windows (Cara Termudah):
1. Ekstrak atau letakkan folder aplikasi ini di komputer Anda.
2. Klik ganda pada berkas:
   ```bat
   scripts\install.bat
   ```
   *Skrip akan memeriksa Node.js, memasang seluruh dependensi, dan menyiapkan folder penyimpanan.*
3. Setelah selesai, jalankan aplikasi dengan mengklik ganda:
   ```bat
   scripts\start.bat
   ```
4. Buka peramban Chrome Anda dan kunjungi:
   ```
   http://localhost:3000
   ```

### Pengguna Linux / macOS / Terminal Manual:
1. Buka terminal di direktori proyek ini.
2. Jalankan perintah instalasi dependensi:
   ```bash
   npm install
   ```
3. Jalankan server aplikasi:
   ```bash
   npm run dev
   ```
4. Buka peramban pada alamat: `http://localhost:3000`

---

## 🧩 PANDUAN PEMASANGAN CHROME EXTENSION
Ekstensi Chrome ini bertugas menjembatani perintah generasi ke tab Google AI Studio Anda.

1. Buka browser **Google Chrome**.
2. Masukkan URL berikut pada bilah alamat Chrome:
   ```
   chrome://extensions/
   ```
3. Di pojok kanan atas layar ekstensi, aktifkan sakelar **"Developer mode"** (Mode Pengembang).
4. Klik tombol **"Load unpacked"** (Muat yang belum dibongkar) di pojok kiri atas.
5. Arahkan dan pilih folder **`extension`** yang ada di dalam direktori aplikasi ini.
   *(Atau dari halaman dashboard website, klik menu "Ekstensi" lalu tombol "Unduh Ekstensi ZIP" dan ekstrak foldernya).*
6. Ekstensi **AI TTS Automation Studio Controller** akan langsung terpasang dan aktif di bilah alat Chrome Anda.
7. Sematkan (*pin*) ikon ekstensi ke bilah alat Chrome agar mudah dipantau.

---

## 🎯 CARA MENGGUNAKAN APLIKASI

### 1. Membuat Pekerjaan Teks
Buka tab **Text Manager**:
- **Single Input:** Masukkan nama berkas (misal: `001-pembukaan`) dan teks suara yang diinginkan, lalu klik **Tambah Pekerjaan**.
- **Bulk Input:** Masukkan banyak teks sekaligus dengan format:
  ```
  nama_file|Isi teks narasi suara Anda di sini...
  001-intro|Selamat pagi dan salam sejahtera untuk kita semua.
  002-materi|Hari ini kita akan mempelajari materi utama.
  ```

### 2. Import TXT dan CSV
- Klik tombol **Import TXT** atau **Import CSV** pada menu Text Manager atau bilah atas Dashboard.
- Format CSV yang didukung: kolom `filename` dan `text` (pemisah koma atau titik-koma).
- Format TXT: baris dengan pemisah `nama_file|teks`.

### 3. Menghubungkan Ekstensi & Google AI Studio
1. Buka tab baru di Chrome dan kunjungi:
   ```
   https://aistudio.google.com/
   ```
2. Pastikan Anda telah masuk (*login*) dengan akun Google Anda dan membuka mode prompt TTS/Audio.
3. Kembali ke dashboard `http://localhost:3000`, periksa kartu indikator di Dashboard:
   - **Backend Online:** Hijau
   - **Audio Processor Ready:** Hijau
   - **Extension Connected:** Hijau
   - **Google AI Studio Connected:** Hijau

### 4. Menjalankan Antrean Generasi
1. Klik tombol **MULAI GENERATE** (Start Queue).
2. Sistem akan bekerja secara otomatis:
   - Teks pertama dikirim ke Google AI Studio.
   - Ekstensi memasukkan teks ke kolom prompt.
   - Ekstensi menekan tombol Run.
   - Menunggu sampai audio selesai dihasilkan.
   - Mengambil file audio WAV.
   - Mentransfer WAV ke backend.
   - Backend mengonversi WAV ke format MP3 192 kbps.
   - Memverifikasi ukuran dan integritas file MP3.
   - Menandai pekerjaan sebagai **COMPLETED**.
   - Melanjutkan pekerjaan berikutnya secara berurutan.
3. Anda dapat menekan **Jeda (Pause)**, **Lanjutkan (Resume)**, atau **Hentikan (Stop)** kapan saja.

### 5. Pemutaran Audio & Unduh File
- Buka tab **Audio Library** untuk mendengarkan hasil rekaman suara.
- Dilengkapi waveform player visual, pengatur volume, preview format WAV dan MP3.
- Klik **Unduh Semua MP3 (.ZIP)** untuk mengunduh seluruh file MP3 sekaligus dalam satu paket berkas terkompresi.

---

## 📂 STRUKTUR PENYIMPANAN LOKAL
Semua file tersimpan langsung di komputer Anda tanpa diunggah ke cloud pihak ketiga:
```
storage/
├── wav/               # File audio mentah WAV hasil ekstraksi
│   ├── 001-pembukaan.wav
│   └── 002-narasi.wav
├── mp3/               # File audio MP3 hasil konversi (192 kbps)
│   ├── 001-pembukaan.mp3
│   └── 002-narasi.mp3
├── failed/            # Berkas cadangan jika ada proses yang gagal
└── metadata/
    ├── jobs.json      # Daftar antrean pekerjaan aktif
    ├── history.json   # Riwayat pekerjaan yang selesai / gagal
    ├── settings.json  # Pengaturan aplikasi
    └── logs.json      # Catatan aktivitas real-time
```

---

## 🧪 MODE PENGUJIAN (MOCK MODE)
Ingin menguji alur kerja website, konversi WAV ke MP3, pemutar suara, dan logika antrean tanpa membuka Google AI Studio?
1. Buka tab **Settings** di website dashboard.
2. Aktifkan opsi **"Mock Testing Mode"**.
3. Klik tombol **MULAI GENERATE**.
4. Sistem akan mensintesis file WAV valid secara otomatis, melakukan konversi MP3 secara lokal, dan menguji seluruh status antrean secara nyata!

---

## 🛠️ TROUBLESHOOTING & SOLUSI MASALAH UMUM

1. **Status Ekstensi "Belum Terhubung" (Disconnected):**
   - Pastikan Anda sudah memuat folder `extension` di `chrome://extensions/`.
   - Klik ikon ekstensi di toolbar Chrome, lalu klik tombol **Sambungkan Ulang**.
   - Pastikan website dibuka melalui `http://localhost:3000`.

2. **Google AI Studio "Tab Tidak Ditemukan":**
   - Buka URL `https://aistudio.google.com/` di jendela Chrome yang sama.
   - Pastikan tab tersebut aktif dan tidak ditutup.

3. **Tombol Run atau Input Teks Tidak Ditemukan:**
   - Klik ikon ekstensi di toolbar Chrome, lalu klik tombol **Uji Selektor AI Studio**.
   - Periksa apakah Google AI Studio sedang menampilkan dialog login atau modal cookie.
   - Anda juga dapat memperbarui selektor pada berkas `extension/selectors.js`.

4. **Konversi MP3 Gagal:**
   - Sistem dilengkapi encoder murni bawaan (*built-in pure-js lamejs*). Jika Anda memiliki FFmpeg terpasang di komputer, Anda dapat beralih ke mode FFmpeg di tab **Settings**.

5. **Menghentikan Server:**
   - Tekan `Ctrl + C` di jendela terminal, atau klik ganda berkas `scripts\stop.bat`.

---
*Dibuat untuk keandalan tinggi dan pemrosesan otomatis Text-to-Speech skala besar.*
