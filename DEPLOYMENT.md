# 🌐 PANDUAN DEPLOYMENT UNIVERSAL (BEBAS DI HOSTING DIMANAPUN)
### AI TTS Automation Studio V1.0 • by: Faiz_Fahmi_ID

Aplikasi ini telah dirancang secara **Universal & Hybrid (Client-First + Server-Ready)**. Artinya:
1. **Bisa dijalankan di Hosting Statis 100% Gratis** tanpa server backend (GitHub Pages, Netlify, Cloudflare Pages, Firebase Hosting, Hostinger, cPanel, dsb.).
2. **Bisa dijalankan di Serverless Cloud** (Vercel dengan fungsi API).
3. **Bisa dijalankan di Container / Full-Stack Node.js** (Docker, Railway, Render, Fly.io, Cloud Run, VPS Linux/Windows).
4. **Bisa dijalankan Lokal di Komputer** via `npm run dev` atau file `.bat`.

---

## 📑 DAFTAR PILIHAN HOSTING

| Platform | Tipe Hosting | Biaya | Panduan |
|---|---|---|---|
| **Vercel** | Serverless + Frontend | 100% Gratis | [Lihat Panduan](#1-deploy-ke-vercel) |
| **Netlify** | Static + Edge Redirect | 100% Gratis | [Lihat Panduan](#2-deploy-ke-netlify) |
| **GitHub Pages** | Otomatis via GitHub Actions | 100% Gratis | [Lihat Panduan](#3-deploy-ke-github-pages) |
| **Cloudflare Pages** | Global CDN Edge | 100% Gratis | [Lihat Panduan](#4-deploy-ke-cloudflare-pages) |
| **Render / Railway** | Full-Stack Node Server | Ada Free Tier | [Lihat Panduan](#5-deploy-ke-render--railway) |
| **Docker / VPS** | Self-Hosted Container | Sesuai Server | [Lihat Panduan](#6-deploy-via-docker--vps) |
| **cPanel / Hostinger** | Shared Web Hosting | Sesuai Domain | [Lihat Panduan](#7-deploy-ke-cpanel--shared-hosting) |

---

## 1. Deploy ke Vercel

Sudah dilengkapi file `vercel.json` dan `api/index.ts` bawaan.
1. Push project ini ke repository GitHub Anda (`git push origin main`).
2. Masuk ke [vercel.com](https://vercel.com/) &rarr; klik **"Add New..."** &rarr; **"Project"**.
3. Import repositori Anda.
4. Vercel akan otomatis mengenali konfigurasi:
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Klik **"Deploy"**. Selesai dalam 1 menit!

---

## 2. Deploy ke Netlify

Sudah dilengkapi `netlify.toml` dan `public/_redirects` bawaan untuk mencegah error 404 saat refresh halaman SPA.

### Opsi A (Melalui GitHub Repo - Direkomendasikan):
1. Buka [netlify.com](https://www.netlify.com/) dan login.
2. Klik **"Add new site"** &rarr; **"Import an existing project"** &rarr; Pilih GitHub.
3. Konfigurasi build (sudah otomatis terisi dari `netlify.toml`):
   - **Base directory**: (kosongkan)
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
4. Klik **"Deploy site"**.

### Opsi B (Manual Drag and Drop Tanpa Git):
1. Di komputer Anda jalankan perintah:
   ```bash
   npm run build
   ```
2. Buka dashboard Netlify &rarr; menu **"Sites"**.
3. Tarik (drag & drop) folder `dist` ke area upload Netlify. Website langsung live seketika!

---

## 3. Deploy ke GitHub Pages (100% Otomatis)

Sudah dilengkapi workflow CI/CD `.github/workflows/deploy.yml`, `public/404.html`, dan `base: './'` di `vite.config.ts`.

1. Push code ke GitHub repo Anda:
   ```bash
   git add .
   git commit -m "feat: universal deploy setup"
   git push origin main
   ```
2. Buka repository Anda di GitHub &rarr; Tab **Settings** &rarr; **Pages** (di sidebar kiri).
3. Pada bagian **Build and deployment** &rarr; **Source**:
   - Pilih: **"GitHub Actions"**.
4. GitHub Actions akan otomatis melakukan build `npm run build` dan mempublikasikan website ke URL:
   `https://<username>.github.io/<nama-repo>/`
5. Berkat pengaturan `base: './'`, semua script dan gambar akan terbaca sempurna di GitHub Pages tanpa takut path rusak!

---

## 4. Deploy ke Cloudflare Pages

1. Login ke [dash.cloudflare.com](https://dash.cloudflare.com/) &rarr; **Workers & Pages** &rarr; **Create application** &rarr; **Pages**.
2. Hubungkan ke GitHub repo Anda.
3. Pengaturan build:
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Klik **"Save and Deploy"**. File `_redirects` di folder `public` otomatis diterapkan oleh Cloudflare.

---

## 5. Deploy ke Render / Railway (Full Node.js Server)

Cocok jika Anda ingin backend Node.js dan Express tetap aktif melayani API `/api/*`:

### Di Railway ([railway.app](https://railway.app/)):
1. Klik **"New Project"** &rarr; **"Deploy from GitHub repo"**.
2. Railway otomatis mendeteksi `Dockerfile` atau `package.json` (`npm start`).
3. Port akan dialokasikan otomatis lewat environment variable `PORT`.

### Di Render ([render.com](https://render.com/)):
1. Klik **"New +"** &rarr; **"Web Service"**.
2. Hubungkan repo GitHub Anda.
3. Atur:
   - **Runtime**: `Node` atau `Docker`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
4. Klik **"Create Web Service"**.

---

## 6. Deploy via Docker / VPS

Sudah disediakan `Dockerfile` dan `docker-compose.yml`.

### Menjalankan dengan Docker Compose (1 Perintah):
```bash
docker compose up -d
```
Aplikasi langsung berjalan di port 3000: `http://localhost:3000` (atau IP VPS Anda).

### Menjalankan dengan Docker Manual:
```bash
docker build -t ai-tts-studio .
docker run -d -p 3000:3000 --name tts-studio-app ai-tts-studio
```

---

## 7. Deploy ke cPanel / Hostinger / Shared Hosting Tradisional

1. Jalankan build di lokal:
   ```bash
   npm run build
   ```
2. Buka folder `dist` yang telah dihasilkan.
3. Kompres folder `dist` menjadi `.zip`, lalu upload dan ekstrak ke folder `public_html` di cPanel File Manager Anda.
4. Buat file `.htaccess` di dalam `public_html` jika ingin dukungan rewrite URL:
   ```apache
   <IfModule mod_rewrite.c>
     RewriteEngine On
     RewriteBase /
     RewriteRule ^index\.html$ - [L]
     RewriteCond %{REQUEST_FILENAME} !-f
     RewriteCond %{REQUEST_FILENAME} !-d
     RewriteRule . /index.html [L]
   </IfModule>
   ```

---

## 💡 Mengapa Sistem Ini Bisa Berjalan di Mana Saja?

1. **Arsitektur Resilient (Graceful Fallback)**:
   File `src/services/api.ts` secara cerdas memeriksa ketersediaan backend. Jika website dihosting di server statis (seperti GitHub Pages) di mana backend Node.js tidak tersedia, aplikasi **secara otomatis beralih ke browser storage (IndexedDB + localStorage)** dan **pemrosesan audio WAV-ke-MP3 dilakukan langsung di browser menggunakan Web Audio API & lamejs**.
2. **Koneksi Ekstensi Chrome Tanpa Hambatan**:
   Komunikasi antara dashboard dan Ekstensi Chrome menggunakan tab handshake native (`window.postMessage` via `bridge.js`) serta sinkronisasi folder lokal (`window.showDirectoryPicker()`). Baik website Anda berada di `localhost`, `vercel.app`, `github.io`, atau domain kustom Anda, ekstensi otomatis terhubung dan mengenali folder unduhan Anda.
3. **Path Relative (`base: './'`)**:
   Memungkinkan aplikasi di-deploy di root domain (`https://domain.com/`) maupun di subdirektori (`https://user.github.io/tts-subfolder/`) tanpa mengubah konfigurasi satupun.
