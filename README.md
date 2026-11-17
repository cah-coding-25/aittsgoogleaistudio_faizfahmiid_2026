# AI TTS Automation Studio

### Professional Text-to-Speech Automation Platform · Version 1.0

**Dikembangkan oleh Faiz_Fahmi_ID**

AI TTS Automation Studio adalah sistem otomasi untuk membantu proses
produksi audio *Text-to-Speech* (TTS) melalui antarmuka Google AI
Studio. Aplikasi ini mengelola teks dalam antrean, menjalankan proses
generasi secara berurutan, mengonversi audio WAV ke MP3 192 kbps, serta
mengatur hasil produksi dalam satu pustaka audio.

> **Fleksibel untuk penggunaan lokal maupun deployment dashboard
> online.**\
> Dashboard dapat di-host di platform seperti Vercel. Namun, proses yang
> membutuhkan akses ke tab Chrome, ekstensi, backend pemrosesan, dan
> penyimpanan lokal tetap bergantung pada komponen yang berjalan di
> komputer pengguna. Deployment dashboard online tidak otomatis mengubah
> seluruh proses menjadi cloud.

------------------------------------------------------------------------

## Daftar Isi

1.  [Gambaran Umum](#gambaran-umum)
2.  [Fitur Utama](#fitur-utama)
3.  [Arsitektur Sistem](#arsitektur-sistem)
4.  [Persyaratan Sistem](#persyaratan-sistem)
5.  [Instalasi dan Menjalankan
    Aplikasi](#instalasi-dan-menjalankan-aplikasi)
6.  [Pemasangan Chrome Extension](#pemasangan-chrome-extension)
7.  [Panduan Penggunaan](#panduan-penggunaan)
8.  [Struktur Penyimpanan](#struktur-penyimpanan)
9.  [Mode Pengujian](#mode-pengujian)
10. [Pemecahan Masalah](#pemecahan-masalah)
11. [Catatan Penggunaan dan Lisensi](#catatan-penggunaan-dan-lisensi)

------------------------------------------------------------------------

## Gambaran Umum

AI TTS Automation Studio dirancang untuk menyederhanakan pekerjaan
pembuatan narasi audio, baik untuk satu teks maupun banyak teks
sekaligus. Sistem menggunakan pendekatan **One Job at a Time** dengan
antrean **FIFO (First In, First Out)** agar setiap pekerjaan diproses
secara teratur.

Alur kerja utama:

1.  Pengguna memasukkan atau mengimpor teks.
2.  Sistem menyusun teks ke dalam antrean pekerjaan.
3.  Chrome Extension menghubungkan dashboard dengan tab Google AI
    Studio.
4.  Teks diproses satu per satu.
5.  Audio hasil generasi diambil dalam format WAV.
6.  Backend mengonversi WAV menjadi MP3 192 kbps.
7.  Hasil dan status pekerjaan disimpan serta ditampilkan di Audio
    Library.

## Fitur Utama

  -----------------------------------------------------------------------
  Fitur                               Deskripsi
  ----------------------------------- -----------------------------------
  **Single & Bulk Input**             Tambahkan satu teks atau banyak
                                      teks sekaligus.

  **Import TXT & CSV**                Impor daftar pekerjaan dari file
                                      teks atau spreadsheet CSV.

  **Chrome Extension Manifest V3**    Penghubung antara dashboard dan tab
                                      Google AI Studio.

  **Antrean FIFO**                    Pekerjaan diproses satu per satu
                                      untuk mengurangi konflik eksekusi.

  **Auto Retry**                      Hingga tiga percobaan ulang dengan
                                      jeda 5, 15, dan 30 detik untuk
                                      kendala sementara.

  **Konversi WAV ke MP3**             Pemrosesan audio ke MP3 192 kbps
                                      menggunakan encoder yang tersedia
                                      di proyek.

  **Penyimpanan & Pemulihan**         Menyimpan file, status pekerjaan,
                                      riwayat, pengaturan, dan log secara
                                      lokal.

  **Audio Library**                   Memutar, melihat waveform,
                                      mengganti nama, dan mengunduh hasil
                                      audio.

  **Unduh ZIP**                       Mengunduh kumpulan file MP3 dalam
                                      satu arsip ZIP.

  **Mock Testing Mode**               Menguji alur aplikasi tanpa
                                      menjalankan generasi melalui Google
                                      AI Studio.
  -----------------------------------------------------------------------

## Arsitektur Sistem

``` text
┌──────────────────────────────────────────────┐
│             Web Dashboard                    │
│              React + Vite                    │
└──────────────────────┬───────────────────────┘
                       │ PostMessage / SSE / REST
                       ▼
┌──────────────────────────────────────────────┐
│          Local Backend & Audio Processor     │
│              Express / Node.js               │
└──────────────────────┬───────────────────────┘
                       │ HTTP Handshake / Heartbeat
                       ▼
┌──────────────────────────────────────────────┐
│          Chrome Extension · Manifest V3      │
│       Service Worker / DOM Automation        │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│           Google AI Studio Tab               │
│          https://aistudio.google.com/        │
└──────────────────────────────────────────────┘
```

**Catatan arsitektur:** Dashboard web dapat dipublikasikan secara
online. Sementara itu, integrasi browser, backend lokal, dan folder
penyimpanan mengikuti konfigurasi proyek yang dijalankan pada komputer
pengguna. Pastikan konfigurasi deployment dan komunikasi antarkomponen
sudah sesuai sebelum digunakan.

## Persyaratan Sistem

-   **Sistem operasi:** Windows 10/11, macOS, atau Linux.
-   **Node.js:** Versi 18 atau lebih baru; disarankan Node.js 20 LTS
    atau 22.
-   **Browser:** Google Chrome versi 110 atau lebih baru.
-   **Koneksi internet:** Diperlukan untuk mengakses Google AI Studio.
-   **Akun Google:** Diperlukan untuk menggunakan Google AI Studio.

## Instalasi dan Menjalankan Aplikasi

### Windows

1.  Ekstrak repositori atau folder aplikasi.

2.  Jalankan file instalasi:

    ``` bat
    scripts\install.bat
    ```

3.  Tunggu hingga pemeriksaan Node.js, instalasi dependensi, dan
    persiapan folder selesai.

4.  Jalankan aplikasi:

    ``` bat
    scripts\start.bat
    ```

5.  Buka alamat berikut di Google Chrome:

    ``` text
    http://localhost:3000
    ```

### Linux / macOS / Terminal

1.  Buka terminal pada direktori proyek.

2.  Instal dependensi:

    ``` bash
    npm install
    ```

3.  Jalankan aplikasi menggunakan skrip proyek:

    ``` bash
    npm run dev
    ```

4.  Buka alamat lokal yang ditampilkan oleh aplikasi. Jika konfigurasi
    proyek menggunakan port 3000, alamatnya adalah:

    ``` text
    http://localhost:3000
    ```

> **Penting:** Pastikan perintah dan port yang digunakan sesuai dengan
> konfigurasi aktual proyek.

## Pemasangan Chrome Extension

Extension berfungsi sebagai penghubung antara dashboard dan tab Google
AI Studio.

1.  Buka Google Chrome.

2.  Kunjungi:

    ``` text
    chrome://extensions/
    ```

3.  Aktifkan **Developer mode**.

4.  Klik **Load unpacked**.

5.  Pilih folder `extension` dari direktori proyek.

6.  Pastikan extension **AI TTS Automation Studio Controller** muncul
    dalam daftar extension.

7.  Sematkan (*pin*) ikon extension ke toolbar agar mudah diakses.

Jika dashboard menyediakan fitur unduh extension ZIP, unduh dan ekstrak
arsip tersebut terlebih dahulu, lalu pilih folder hasil ekstraksi
melalui **Load unpacked**.

## Panduan Penggunaan

### 1. Membuat Pekerjaan Teks

Buka tab **Text Manager**.

-   **Single Input:** Masukkan nama file, misalnya `001-pembukaan`, lalu
    isi teks narasi dan klik **Tambah Pekerjaan**.

-   **Bulk Input:** Masukkan beberapa pekerjaan dengan format satu
    pekerjaan per baris:

    ``` text
    nama_file|Isi teks narasi
    001-intro|Selamat pagi dan salam sejahtera untuk kita semua.
    002-materi|Hari ini kita akan mempelajari materi utama.
    ```

Gunakan nama file yang unik agar hasil audio lebih mudah dikelola.

### 2. Import TXT dan CSV

-   Pilih **Import TXT** atau **Import CSV** pada Text Manager atau
    Dashboard.
-   Format TXT menggunakan pola `nama_file|teks`.
-   Format CSV mendukung kolom `filename` dan `text`, dengan pemisah
    koma atau titik koma sesuai dukungan parser proyek.

Contoh struktur CSV:

``` csv
filename,text
001-intro,Selamat pagi dan salam sejahtera.
002-materi,Hari ini kita akan membahas materi utama.
```

### 3. Menghubungkan Extension dan Google AI Studio

1.  Buka tab baru dan kunjungi [Google AI
    Studio](https://aistudio.google.com/).
2.  Masuk menggunakan akun Google.
3.  Buka fitur atau mode yang mendukung generasi audio/TTS.
4.  Kembali ke dashboard.
5.  Periksa indikator koneksi yang tersedia.

Indikator yang diharapkan:

-   **Backend Online**
-   **Audio Processor Ready**
-   **Extension Connected**
-   **Google AI Studio Connected**

Status dan nama indikator dapat mengikuti versi antarmuka aplikasi.

### 4. Menjalankan Antrean Generasi

1.  Pastikan semua komponen yang dibutuhkan sudah terhubung.
2.  Klik **MULAI GENERATE** atau **Start Queue**.
3.  Sistem akan memproses pekerjaan secara berurutan:
    -   Mengirim teks pekerjaan ke Google AI Studio.
    -   Memasukkan teks ke kolom prompt melalui extension.
    -   Menjalankan proses generasi.
    -   Menunggu audio selesai dibuat.
    -   Mengambil audio WAV.
    -   Mengirim file ke backend.
    -   Mengonversi WAV menjadi MP3 192 kbps.
    -   Memeriksa hasil konversi.
    -   Memperbarui status pekerjaan.
    -   Melanjutkan ke pekerjaan berikutnya.

Kontrol antrean yang tersedia:

-   **Pause:** Menjeda proses.
-   **Resume:** Melanjutkan proses.
-   **Stop:** Menghentikan antrean.

### 5. Memutar dan Mengunduh Audio

Buka tab **Audio Library** untuk mengelola hasil generasi. Fitur yang
tersedia sesuai implementasi proyek dapat mencakup:

-   Pemutar audio dan visualisasi waveform.
-   Preview file WAV dan MP3.
-   Pengaturan volume.
-   Penggantian nama file.
-   Unduh file satu per satu.
-   **Unduh Semua MP3 (.ZIP)** untuk mengunduh seluruh hasil dalam satu
    arsip.

## Struktur Penyimpanan

Contoh struktur direktori penyimpanan lokal:

``` text
storage/
├── wav/                  # Audio mentah hasil generasi
│   ├── 001-pembukaan.wav
│   └── 002-narasi.wav
├── mp3/                  # Audio hasil konversi MP3
│   ├── 001-pembukaan.mp3
│   └── 002-narasi.mp3
├── failed/               # File atau pekerjaan yang gagal
└── metadata/
    ├── jobs.json         # Antrean pekerjaan
    ├── history.json      # Riwayat pekerjaan
    ├── settings.json     # Pengaturan aplikasi
    └── logs.json         # Catatan aktivitas
```

Lokasi dan nama folder dapat berbeda mengikuti konfigurasi proyek.
Lakukan pencadangan berkala terhadap file audio dan metadata penting.

## Mode Pengujian

**Mock Testing Mode** dapat digunakan untuk menguji alur aplikasi tanpa
menjalankan generasi melalui Google AI Studio.

1.  Buka tab **Settings**.
2.  Aktifkan **Mock Testing Mode**.
3.  Kembali ke Dashboard.
4.  Klik **MULAI GENERATE**.
5.  Amati proses antrean, status pekerjaan, dan hasil pengujian.

Mode ini ditujukan untuk pengujian alur kerja. Hasil audio mock bukan
pengganti hasil generasi TTS sebenarnya.

## Pemecahan Masalah

### Extension berstatus Disconnected

-   Pastikan folder `extension` sudah dimuat melalui
    `chrome://extensions/`.
-   Periksa apakah extension aktif.
-   Klik **Sambungkan Ulang** jika tombol tersebut tersedia.
-   Pastikan dashboard dibuka melalui alamat yang sesuai dengan
    konfigurasi backend, misalnya `http://localhost:3000`.

### Google AI Studio tidak ditemukan

-   Pastikan tab [Google AI Studio](https://aistudio.google.com/)
    terbuka di jendela Chrome yang sama.
-   Periksa koneksi internet dan status login akun Google.
-   Pastikan tab tidak ditutup atau mengalami error.

### Tombol Run atau kolom input tidak ditemukan

-   Jalankan **Uji Selektor AI Studio** jika tersedia.
-   Periksa apakah halaman menampilkan dialog login, persetujuan, atau
    modal lainnya.
-   Periksa kompatibilitas selector pada `extension/selectors.js`.
-   Perubahan antarmuka Google AI Studio dapat memengaruhi selector
    extension.

### Konversi MP3 gagal

-   Periksa log backend dan pastikan file WAV sumber tersedia.
-   Pastikan encoder yang digunakan proyek telah terpasang atau termuat
    dengan benar.
-   Jika proyek mendukung FFmpeg, periksa konfigurasi dan instalasi
    FFmpeg sebelum mengaktifkan mode tersebut.

### Menghentikan server

-   Pada terminal, tekan `Ctrl + C`.
-   Pada instalasi Windows yang menyediakan skrip terkait, jalankan
    `scripts\stop.bat`.

------------------------------------------------------------------------

## Catatan Penggunaan dan Lisensi

Aplikasi dan dokumentasi ini boleh digunakan untuk kebutuhan pribadi,
pembelajaran, eksperimen, konten kreatif, serta kegiatan edukasi.
Pengguna tetap bertanggung jawab untuk mematuhi ketentuan layanan
platform dan hak atas materi yang digunakan.

**DIPERBOLEHKAN:** menggunakan aplikasi ini untuk membuat konten, materi
pembelajaran, demonstrasi, dan keperluan edukasi.

**DILARANG KERAS:** menjual, memperjualbelikan, menyewakan, atau
mendistribusikan ulang aplikasi ini maupun bagian-bagiannya sebagai
produk berbayar tanpa izin tertulis dari pengembang.

------------------------------------------------------------------------

**© Faiz_Fahmi_ID · AI TTS Automation Studio**

*Dibuat untuk mendukung alur kerja produksi audio TTS yang lebih
terstruktur, efisien, dan mudah dikelola.*
