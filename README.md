# REMIX V3 AI TTS AUTOMATION STUDIO V1.0
### Panduan Penggunaan Lengkap: Unduh Repo, Upload GitHub Pribadi, Deploy Vercel, & Seluruh Fitur Studio
**Dibuat & Dikembangkan oleh: Faiz_Fahmi_ID 2026**

---

## 📑 DAFTAR ISI
1. [Tentang Aplikasi](#1-tentang-aplikasi)
2. [Tahap 1: Mengunduh Repositori Ini ke Komputer Anda](#tahap-1-mengunduh-repositori-ini-ke-komputer-anda)
3. [Tahap 2: Mengunggah ke Repositori GitHub Pribadi Anda](#tahap-2-mengunggah-ke-repositori-github-pribadi-anda)
4. [Tahap 3: Deploy Gratis ke Vercel (Online 24/7 Tanpa File .BAT)](#tahap-3-deploy-gratis-ke-vercel-online-247-tanpa-file-bat)
5. [Tahap 4: Menjalankan Secara Lokal di Komputer (Alternatif Developer)](#tahap-4-menjalankan-secara-lokal-di-komputer-alternatif-developer)
6. [Tahap 5: Memasang Ekstensi Chrome Manifest V3](#tahap-5-memasang-ekstensi-chrome-manifest-v3)
7. [Tahap 6: Menghubungkan Ekstensi ke Dashboard Website](#tahap-6-menghubungkan-ekstensi-ke-dashboard-website)
8. [Tahap 7: Memilih Folder Unduhan WAV Lokal di Komputer](#tahap-7-memilih-folder-unduhan-wav-lokal-di-komputer)
9. [Panduan Lengkap Penggunaan Seluruh Fitur Website](#panduan-lengkap-penggunaan-seluruh-fitur-website)
   - [A. Text Manager & Bulk Ingestion](#a-text-manager--bulk-ingestion)
   - [B. Generation Queue (Antrean Strict FIFO)](#b-generation-queue-antrean-strict-fifo)
   - [C. Otomasi Browser Google AI Studio (Side Dock Runner)](#c-otomasi-browser-google-ai-studio-side-dock-runner)
   - [D. Audio Library, Pemindai Folder, & Pemutar Suara](#d-audio-library-pemindai-folder--pemutar-suara)
   - [E. Konversi WAV ke MP3 Asli (LAME Encoder 192 kbps)](#e-konversi-wav-ke-mp3-asli-lame-encoder-192-kbps)
   - [F. Fitur Unduh Berkas Satuan & Batch ZIP](#f-fitur-unduh-berkas-satuan--batch-zip)
   - [G. Workspace PC & Isolasi Data Perangkat](#g-workspace-pc--isolasi-data-perangkat)
   - [H. Penanganan Pekerjaan Gagal & Auto-Retry](#h-penanganan-pekerjaan-gagal--auto-retry)
   - [I. Log Konsol & Diagnostik Realtime](#i-log-konsol--diagnostik-realtime)
   - [J. Mode Simulasi Pengujian (Mock Mode)](#j-mode-simulasi-pengujian-mock-mode)
10. [Troubleshooting & Solusi Kendala Umum](#troubleshooting--solusi-kendala-umum)

---

## 1. TENTANG APLIKASI
**Remix v3 AI TTS Automation Studio V1.0** adalah sistem otomasi generasi suara berbasis Google AI Studio (Gemini Flash TTS) yang dirancang untuk produksi massal narasi suara berurutan (*One Job at a Time*). Dilengkapi dengan:
- Ekstensi Chrome Manifest V3 yang ringan (&lt; 15 MB RAM).
- Antrean terurut otomatis tanpa batas (*unlimited FIFO pipeline*).
- Konverter audio WAV mentah ke MP3 192 kbps bawaan murni (Pure JS LAME).
- Unduh batch file WAV asli atau MP3 hasil konversi dalam bentuk ZIP.
- Arsitektur **Zero-BAT**: Cukup buka dashboard di web (bisa di Vercel online), tidak perlu menjalankan skrip `.bat` di komputer pengguna.

---

## TAHAP 1: MENGUNDUH REPOSITORI INI KE KOMPUTER ANDA

Terdapat dua cara mudah untuk mengunduh kode proyek ini ke komputer Anda:

### Opsi A: Unduh Berkas ZIP Langsung (Paling Mudah)
1. Pada halaman repositori ini, klik tombol hijau bertuliskan **Code**.
2. Pilih opsi **Download ZIP**.
3. Simpan berkas ZIP di komputer Anda (misalnya di folder `D:\AI-TTS-Studio` atau `Downloads`).
4. Klik kanan pada berkas `.zip` yang telah diunduh, lalu pilih **Extract All...** (Ekstrak ke folder baru).

### Opsi B: Menggunakan Git Clone (Bagi Pengguna Terminal)
1. Buka aplikasi **Terminal** (macOS/Linux) atau **Command Prompt / Git Bash / PowerShell** (Windows).
2. Ketik perintah berikut lalu tekan Enter:
   ```bash
   git clone <URL_REPOSITORI_INI>
   cd aitts-mentahv1-2026
   ```

---

## TAHAP 2: MENGUNGGAH KE REPOSITORI GITHUB PRIBADI ANDA

Agar Anda memiliki salinan kode proyek sendiri dan dapat menghubungkannya ke layanan hosting Vercel, ikuti langkah berikut:

### Langkah 1: Buat Repositori Baru di Akun GitHub Anda
1. Buka peramban dan login ke akun Anda di [https://github.com](https://github.com).
2. Di pojok kanan atas, klik tanda tambah (`+`) lalu pilih **New repository**.
3. Beri nama repositori, misalnya: `my-ai-tts-studio`.
4. Pilih status **Public** atau **Private** (disarankan *Private* jika untuk pemakaian pribadi).
5. **Jangan centang** opsi *"Add a README file"*, *"Add .gitignore"*, atau *"Choose a license"* karena berkas-berkas tersebut sudah tersedia di repositori ini.
6. Klik tombol hijau **Create repository**.
7. Salin URL repositori baru Anda (contoh: `https://github.com/username-anda/my-ai-tts-studio.git`).

### Langkah 2: Unggah Berkas Menggunakan Git CLI
1. Buka terminal atau Command Prompt di dalam folder hasil ekstraksi kode tadi.
2. Jalankan perintah berikut secara berurutan:
   ```bash
   # Inisialisasi git lokal
   git init

   # Tambahkan semua berkas ke staging
   git add .

   # Buat commit perdana
   git commit -m "Inisialisasi Remix v3 AI TTS Automation Studio by Faiz_Fahmi_ID 2026"

   # Ubah nama branch utama menjadi main
   git branch -M main

   # Sambungkan ke repositori GitHub pribadi Anda
   git remote add origin https://github.com/username-anda/my-ai-tts-studio.git

   # Unggah seluruh kode ke GitHub
   git push -u origin main
   ```
*(Jika muncul jendela login GitHub, silakan masukkan username & Personal Access Token akun GitHub Anda).*

---

## TAHAP 3: DEPLOY GRATIS KE VERCEL (ONLINE 24/7 TANPA FILE .BAT)

Vercel adalah platform cloud hosting gratis berkecepatan tinggi yang dapat menjalankan dashboard web studio ini secara online:

1. Buka [https://vercel.com](https://vercel.com) dan login menggunakan akun GitHub Anda.
2. Di halaman Vercel Dashboard, klik tombol **Add New...** di pojok kanan atas, lalu pilih **Project**.
3. Di daftar repositori GitHub yang muncul, temukan repositori pribadi Anda yang baru diunggah (`my-ai-tts-studio`), lalu klik tombol **Import**.
4. Di bagian konfigurasi proyek (*Configure Project*):
   - **Project Name:** Biarkan nama default atau ganti sesuai keinginan (misal: `ai-tts-studio-faiz`).
   - **Framework Preset:** Pilih **Vite** (atau biarkan *Other* jika terdeteksi otomatis).
   - **Root Directory:** `./` (default).
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
5. Klik tombol biru **Deploy**.
6. Tunggu sekitar 1–2 menit hingga proses build selesai.
7. Setelah selesai, Vercel akan memberikan link website online Anda, misalnya:
   `https://ai-tts-studio-faiz.vercel.app`
8. Buka tautan tersebut di browser Google Chrome Anda!

---

## TAHAP 4: MENJALANKAN SECARA LOKAL DI KOMPUTER (ALTERNATIF DEVELOPER)

Jika Anda ingin menjalankan aplikasi secara offline atau lokal di komputer sendiri:

### Persyaratan:
- Komputer dengan sistem operasi Windows 10/11, macOS, atau Linux.
- Telah memasang [Node.js](https://nodejs.org) (versi 18, 20 LTS, atau 22).

### Langkah Menjalankan:
1. Buka Command Prompt atau Terminal di dalam folder proyek.
2. Pasang dependensi:
   ```bash
   npm install
   ```
3. Jalankan server aplikasi:
   ```bash
   npm run dev
   ```
4. Buka peramban Google Chrome dan buka alamat:
   ```
   http://localhost:3000
   ```

---

## TAHAP 5: MEMASANG EKSTENSI CHROME MANIFEST V3

Ekstensi Chrome bertugas melakukan otomasi penempelan teks, menekan tombol *Run*, dan mengunduh audio di tab Google AI Studio Anda.

1. Buka dashboard web Anda (baik versi Vercel online maupun `localhost`).
2. Masuk ke tab menu **Ekstensi Chrome** di sidebar/menu.
3. Klik tombol hijau/biru bertuliskan:
   `Unduh Ekstensi ZIP (Siap Pakai)`
   *Website akan otomatis mengemas berkas ekstensi terbaru ke dalam file `ai-tts-extension.zip`.*
4. Buka folder unduhan komputer Anda, lalu **ekstrak file ZIP tersebut** ke folder permanen (misal: `D:\ChromeExtensions\ai-tts-extension`).
5. Buka tab baru di browser Google Chrome, lalu ketik pada bilah alamat URL:
   ```
   chrome://extensions/
   ```
   kemudian tekan **Enter**.
6. Di pojok kanan atas halaman ekstensi, aktifkan sakelar **Mode pengembang (Developer mode)**.
7. Di pojok kiri atas, klik tombol **Muat yang belum dibongkar (Load unpacked)**.
8. Pilih folder hasil ekstrak ekstensi tadi (`ai-tts-extension`).
9. Ekstensi bernama **"AI TTS Automation Runner"** kini telah berhasil terpasang di browser Chrome Anda!

---

## TAHAP 6: MENGHUBUNGKAN EKSTENSI KE DASHBOARD WEBSITE

1. Klik ikon puzzle ekstensi di toolbar pojok kanan atas Google Chrome Anda, lalu sematkan (*pin*) ekstensi **AI TTS Automation Runner**.
2. Klik ikon ekstensi untuk membuka jendela pop-up.
3. Di kolom **Target Web Dashboard**, masukkan URL website dashboard Anda:
   - Jika memakai Vercel: `https://ai-tts-studio-faiz.vercel.app`
   - Jika memakai lokal: `http://localhost:3000`
4. Klik tombol **Simpan**.
5. Indikator status di pojok kanan atas pop-up ekstensi akan berubah menjadi hijau bertuliskan **ONLINE**.

---

## TAHAP 7: MEMILIH FOLDER UNDUHAN WAV LOKAL DI KOMPUTER

Fitur ini memastikan seluruh audio WAV asli yang diunduh dari Google AI Studio langsung masuk ke folder yang Anda kehendaki di komputer tanpa memunculkan kotak dialog "Save As" berulang kali:

1. Klik ikon ekstensi di pojok kanan atas Chrome atau buka panel samping dock di tab Google AI Studio.
2. Di bagian **FOLDER SIMPAN WAV ASLI**, Anda akan melihat tombol biru bertuliskan:
   `📂 Pilih Folder di Komputer Ini (Buka Dialog)`
3. Klik tombol tersebut. Chrome akan menampilkan jendela dialog sistem untuk memilih folder di penyimpanan komputer Anda (misalnya buat folder baru: `D:\AudioProyekTTS`).
4. Pilih folder tersebut dan setujui izin akses (*Allow Edit Access*).
5. **Selesai!** Mulai saat ini, setiap file WAV yang selesai digenerate oleh Google AI Studio akan langsung masuk ke folder ini secara otomatis.

---

## PANDUAN LENGKAP PENGGUNAAN SELURUH FITUR WEBSITE

### A. Text Manager & Bulk Ingestion
1. **Tambah Teks Satuan (Single Input):**
   - Klik tombol **Tambah Teks**.
   - Masukkan nama file (contoh: `001-intro`) dan isi naskah narasi suara.
   - Klik **Tambahkan**.
2. **Tambah Teks Massal (Bulk Input):**
   - Beralih ke tab **Mode B — Bulk Input**.
   - Masukkan teks dengan format:
     ```
     001-pembuka|Halo teman-teman, selamat datang di channel kami.
     002-isi|Hari ini kita akan mengulas teknologi audio AI terbaru.
     003-penutup|Jangan lupa untuk subscribe dan tinggalkan komentar.
     ```
   - Atau cukup tempelkan baris teks biasa per baris tanpa pembatas, sistem akan otomatis memberi penomoran urut (`001-track`, `002-track`, dst.).
3. **Import dari File TXT & CSV:**
   - Gunakan tombol **Import TXT** atau **Import CSV** untuk mengunggah file spreadsheet atau dokumen teks naskah Anda.
4. **Pemeriksa Duplikasi Nama & Reordering:**
   - Sistem memberikan tanda badge oranye jika ada nama file yang sama agar file audio Anda tidak saling menimpa.
   - Gunakan panah naik/turun di kolom *Urutan* untuk mengubah prioritas pengerjaan.

### B. Generation Queue (Antrean Strict FIFO)
- Buka menu **Antrean Pemrosesan**.
- Di sini seluruh teks yang telah Anda masukkan tersusun rapi dengan nomor antrean `#1`, `#2`, `#3`, dst.
- Klik tombol **MULAI ANTREAN** untuk memulai otomasi.
- **Strict FIFO:** Sistem hanya memproses 1 pekerjaan suara dalam satu waktu. Pekerjaan kedua tidak akan disentuh sebelum pekerjaan pertama berhasil diunduh dan diverifikasi integritas audionya.
- Tombol **Jeda (Pause)** dapat digunakan jika Anda ingin menghentikan sementara proses, dan **Lanjutkan (Resume)** untuk meneruskannya kembali kapan saja.

### C. Otomasi Browser Google AI Studio (Side Dock Runner)
1. Buka tab baru di Chrome dan kunjungi Google AI Studio Speech Playground:
   ```
   https://aistudio.google.com/generate-speech
   ```
2. Pastikan Anda telah memilih suara yang diinginkan (*Speaker Voice* dan *Style*).
3. Di sisi kanan layar, Anda akan melihat panel **Dock Runner AI TTS Studio**.
4. Saat antrean di website aktif, ekstensi akan secara otomatis:
   - Menempelkan teks antrean saat ini ke kolom prompt.
   - Menekan tombol **Run (Ctrl + Enter)**.
   - Memantau proses rendering hingga tombol unduh muncul.
   - Mengunduh file WAV asli langsung ke folder komputer yang sudah Anda pilih.
   - Mengirim sinyal selesai ke website dashboard untuk langsung melanjutkan pekerjaan nomor berikutnya!
5. Anda dapat menyembunyikan panel ini ke tepi layar dengan mengklik tombol panah ciutkan (*collapse*) agar tidak mengganggu pandangan kerja Anda.

### D. Audio Library, Pemindai Folder, & Pemutar Suara
1. **Pemindai Folder Pantau:**
   - Di tab **Audio Library**, klik tombol **"📂 Sambungkan Folder Pantau WAV"** untuk menghubungkan folder unduhan Anda ke website.
   - Kapan pun ada file WAV baru yang masuk ke folder tersebut, klik **"🔄 Pindai Berkas WAV Baru"**, maka website akan langsung mendeteksi file tersebut.
2. **Pemutar Audio Terintegrasi:**
   - Setiap kartu audio dilengkapi tombol putar instan untuk membandingkan audio **WAV Asli** atau audio **MP3 Hasil Konversi**.
   - Dilengkapi visualizer scrubber waktu dan kontrol volume.

### E. Konversi WAV ke MP3 Asli (LAME Encoder 192 kbps)
- **Konversi Otomatis:** Aktifkan sakelar *"Auto-Convert WAV ke MP3"* di Audio Library agar setiap file WAV yang masuk langsung diubah ke format MP3 secara realtime.
- **Konversi Manual Satuan:** Klik tombol *"Ubah ke MP3"* pada kartu file tertentu.
- **Konversi Massal Sekaligus:** Klik tombol besar *"Ubah Semua WAV ke MP3 Sekaligus"* untuk mengonversi puluhan file WAV yang belum dikonversi secara berurutan.

### F. Fitur Unduh Berkas Satuan & Batch ZIP
- **Unduh Parsial:** Pada setiap kartu audio, Anda dapat memilih mengunduh hanya file WAV asli saja atau hanya file MP3 saja.
- **Unduh Semua MP3 (.zip):** Klik tombol *"Unduh Semua MP3 (.zip)"* di pojok kanan atas Audio Library untuk mengunduh seluruh MP3 yang telah digenerate dalam satu paket arsip ZIP siap pakai.
- **Unduh Semua WAV (.zip):** Klik tombol *"Unduh Semua WAV (.zip)"* jika Anda membutuhkan salinan master audio mentah berkualitas tertinggi.

### G. Workspace PC & Isolasi Data Perangkat
- Setiap komputer/laptop yang membuka website ini diberikan identitas unik (*Client ID*) yang terisolasi.
- Data antrean teks dan riwayat audio Anda tersimpan di penyimpanan lokal browser PC tersebut.
- Klik menu **Workspace PC** untuk:
  - Mengubah label nama perangkat Anda.
  - **Ekspor Cadangan:** Mengunduh file JSON backup seluruh antrean dan pengaturan.
  - **Impor Cadangan:** Memulihkan data antrean di komputer lain.
  - **Restart & Reset Total Sistem:** Membersihkan data cache lokal dan memulai sesi baru secara bersih.

### H. Penanganan Pekerjaan Gagal & Auto-Retry
- Jika Google AI Studio mengalami *timeout* atau gangguan jaringan, sistem akan otomatis melakukan percobaan ulang hingga 3 kali.
- Jika tetap gagal, pekerjaan akan dipindahkan ke menu **Pekerjaan Gagal (Failed Jobs)** dengan keterangan diagnostik penyebab kegagalan.
- Anda dapat mengklik tombol **Coba Ulang (Retry)** atau menggunakan fitur **Upload WAV Manual** untuk melampirkan berkas audio yang Anda unduh manual.

### I. Log Konsol & Diagnostik Realtime
- Buka tab **Activity Logs** untuk melihat catatan teknis setiap detik eksekusi: pengiriman prompt, waktu respons Google AI Studio, proses ekstraksi WAV, waktu encoding LAME MP3, hingga latensi jaringan.
- Dilengkapi filter log: `ALL`, `INFO`, `SUCCESS`, `WARN`, dan `ERROR`.

### J. Mode Simulasi Pengujian (Mock Mode)
- Anda dapat menguji seluruh alur antrean, pembuatan audio WAV buatan, dan konversi MP3 tanpa harus membuka tab Google AI Studio asli.
- Masuk ke tab **Pengaturan (Settings)**, aktifkan sakelar **Mode Uji Coba Cepat (Mock Mode)**, lalu jalankan antrean untuk melihat cara kerja sistem secara instan.

---

## TROUBLESHOOTING & SOLUSI KENDALA UMUM

1. **Status Ekstensi Tetap OFFLINE:**
   - Pastikan URL di pop-up ekstensi sama persis dengan URL website dashboard Anda (jangan lupa menyertakan `https://` atau `http://`).
   - Buka tab Ekstensi di website dan klik tombol *"Koneksikan Ekstensi ke URL Ini"*.
2. **Ekstensi Tidak Mengetik di Google AI Studio:**
   - Pastikan Anda membuka halaman resmi: `https://aistudio.google.com/generate-speech`
   - Pastikan Anda sudah login ke akun Google Anda di halaman tersebut.
   - Segarkan (*refresh*) halaman Google AI Studio satu kali setelah memasang ekstensi.
3. **Audio WAV Masuk ke Folder Download Biasa (Bukan Folder Pilihan):**
   - Buka pengaturan browser Chrome Anda di `chrome://settings/downloads`.
   - Pastikan sakelar *"Tanyakan lokasi penyimpanan setiap file sebelum mengunduh"* dalam keadaan **MATI (OFF)** agar unduhan berjalan otomatis tanpa popup konfirmasi.
4. **Tampilan di Ponsel / Tablet:**
   - Website dirancang 100% responsif. Pada layar smartphone, menu navigasi tersedia pada kapsul di bagian bawah layar dan daftar antrean tampil dalam bentuk kartu sentuh ringkas.

---

**Hak Cipta & Pengembangan:**  
*Remix v3 AI TTS Automation Studio V1.0* — **by: Faiz_Fahmi_ID 2026**  
Dilisensikan di bawah Lisensi MIT. Bebas dimodifikasi dan digunakan untuk kebutuhan produksi konten Anda!
**Peraturan Penggunaan code:** Dilarang keras untuk menjual belikan seluruh isi code yang tercantum. Hanya di perbolehkan untuk kebutuhan pribadi , konten sosial media dan proses pembelajaran.Jika ingin menjual belikannya hubungi kontak terkait.
