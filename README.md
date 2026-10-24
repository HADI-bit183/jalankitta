# JalanKitta — Platform Pemantauan Infrastruktur Jalan Provinsi Lampung

Purwarupa untuk **Lomba Nasional Web Desain Gematik 2026**  
Tema: *"Empowering Global Innovators for an Intelligent Future"*  
Fokus: **SDG 9 — Industri, Inovasi, dan Infrastruktur**

---

## 📌 Ringkasan Proyek

**JalanKitta** adalah platform web multi-halaman yang mengintegrasikan pemetaan spasial interaktif dan partisipasi warga (*civic tech*) untuk memantau dan mempercepat penanganan jalan rusak di Provinsi Lampung.

> **Status: prototipe kompetisi.** Data ruas jalan dan kondisinya adalah **data contoh** (bukan survei/data resmi), gambar hero dan kartu kondisi adalah **ilustrasi buatan AI**, dan belum ada kemitraan resmi dengan instansi pemerintah. Rute alternatif dan statistik per kabupaten/kota belum diimplementasikan.

Platform terhubung langsung ke **Supabase** (PostgreSQL dengan *Row Level Security*) dan menerapkan sanitasi XSS, validasi berkas, penghapusan EXIF foto, serta *Subresource Integrity* untuk Leaflet. CSS Tailwind dibuild dengan CLI menjadi satu berkas (`assets/css/tailwind.css`).

---

## 📁 Struktur Folder Terbaru

```
jalankitta/
├── index.html              # Landing Page utama (Hero, Layanan, Kondisi Jalan, Langkah Lapor, SDG 9, Footer)
├── app.html                # Peta Interaktif Jalan Lampung, Filter Kondisi, Statistik Publik, & Formulir Lapor
├── login.html              # Halaman Autentikasi Warga & Petugas (Login, Registrasi, Reset Password)
├── admin.html              # Dashboard Portal Admin (Manajemen & Verifikasi Status Laporan)
├── assets/
│   ├── css/
│   │   ├── style.css       # Kustomisasi CSS (animasi, dark mode, marker peta, ticker)
│   │   └── tailwind.css    # HASIL BUILD Tailwind CLI (npm run build:css)
│   ├── icons/
│   │   └── logo.svg        # Logo vektor (amber-oranye)
│   ├── img/                # Ilustrasi buatan AI (lihat Kredit)
│   └── js/
│       └── auth.js         # Sesi Supabase Auth, RBAC Admin, helper global
├── src/tailwind.input.css  # Input Tailwind CLI
├── tailwind.config.js      # Konfigurasi tema bersama (satu sumber untuk semua halaman)
├── supabase/
│   ├── schema.sql              # Skema, View, RLS, Storage, trigger keamanan, seed 3 ruas
│   └── seed_ruas_tambahan.sql  # 11 ruas contoh tambahan (hasil scripts/generate_seed_ruas.mjs)
├── scripts/
│   ├── generate_seed_ruas.mjs  # Ambil geometri dari OSRM -> SQL
│   └── package.sh              # Buat zip pengumpulan bersih
├── pengumpulan/            # Draf surat orisinalitas, proposal, template link demo
├── .gitignore
└── README.md
```

---

## 🛠️ Panduan Setup Supabase (Pemasangan dari Nol)

Untuk mereplikasi backend database secara mandiri:

### 1. Eksekusi Skema Database
1. Buka project Anda di [Supabase Dashboard](https://supabase.com).
2. Masuk ke menu **SQL Editor**, buka berkas [`supabase/schema.sql`](supabase/schema.sql), lalu klik **Run**.
3. Skrip secara otomatis membuat:
   - Tabel `ruas_jalan`, `laporan_warga`, `admins`, dan `subscribers`.
   - View publik `laporan_publik` dan agregat `statistik_publik`.
   - Kebijakan *Row Level Security* (RLS) lengkap.
   - Bucket Storage `foto_laporan` berstatus publik beserta aturan keamanannya.
   - Trigger keamanan: nama pelapor diambil dari token login, batas 10 laporan/24 jam per pengguna, batas 200 subscriber/jam.
   - Seed 3 ruas contoh. Untuk 11 ruas tambahan, jalankan juga [`supabase/seed_ruas_tambahan.sql`](supabase/seed_ruas_tambahan.sql) (total 14 ruas, **data contoh**).
> **Catatan:** Skema ini aman dijalankan berulang kali (*idempotent*), dan host pada constraint `foto_url_valid` perlu disesuaikan jika memakai proyek Supabase lain.

### 2. Konfigurasi URL Autentikasi (Redirect URLs)
1. Buka **Authentication > URL Configuration**.
2. Masukkan URL domain atau lingkungan lokal Anda pada **Redirect URLs**, contohnya:
   - `http://localhost:8080/login.html`
   - `http://localhost:8080/app.html`
   - `https://<URL-DEPLOY-ANDA>/login.html`
   - `https://<URL-DEPLOY-ANDA>/app.html`
   Atur juga **Site URL** ke URL deploy. Membuka lewat `file://` tidak didukung (redirect auth gagal) — gunakan deploy (Netlify/Vercel/GitHub Pages) atau server lokal.

### 2b. Siapkan Akun Demo untuk Juri
Pendaftaran butuh verifikasi email dan SMTP bawaan Supabase sangat terbatas, jadi juri bisa gagal mendaftar. Buat dua akun lewat **Authentication > Users > Add user** (centang *Auto Confirm User*), lalu jadikan salah satunya admin (langkah 3), dan tulis kredensialnya di proposal/`pengumpulan/Link_Demo.txt`:
- Pelapor demo: `ISI_EMAIL` / `ISI_PASSWORD`
- Admin demo: `ISI_EMAIL` / `ISI_PASSWORD`

### 2c. Cegah Project Di-pause
Project Supabase gratis di-pause setelah ±1 minggu tanpa aktivitas. Buka situs (atau jalankan query ringan) tiap beberapa hari menjelang dan selama masa penjurian, dan cek status project di dashboard sebelum pengumpulan.

### 3. Daftarkan Akun Admin Pertama
1. Buka aplikasi dan daftarkan akun baru melalui `login.html`.
2. Buka **Authentication > Users** di Supabase Dashboard, lalu salin **UID** user tersebut.
3. Jalankan query SQL berikut di SQL Editor:
   ```sql
   INSERT INTO public.admins (user_id) VALUES ('<UUID_USER_ANDA>');
   ```
4. Akun tersebut kini memiliki akses penuh ke [admin.html](admin.html) untuk memverifikasi dan mengubah status laporan masyarakat.

### 4. Konfigurasi Kunci API (Bila Menggunakan Instance Baru)
Jika menggunakan proyek Supabase Anda sendiri, perbarui konstanta di awal berkas [`assets/js/auth.js`](assets/js/auth.js):
```javascript
const SUPABASE_URL = 'https://<PROJECT-ID>.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_...';
```

---

## 🚀 Menjalankan Aplikasi Secara Lokal

Aplikasi tidak membutuhkan build bundler (seperti Webpack/Vite) dan dapat dijalankan langsung dengan server statis lokal apa pun:

### Build CSS (wajib setelah mengubah kelas Tailwind)
```bash
npm install
npm run build:css   # menghasilkan assets/css/tailwind.css
```

### Menggunakan Python (Bawaan macOS/Linux/Windows)
```bash
python3 -m http.server 8080
```

### Menggunakan Node.js
```bash
npx -y serve .
```

Buka peramban di: **`http://localhost:8080`**

> **Catatan GPS / Geolocation:**  
> Fitur pendeteksi koordinat otomatis (*Lokasi Saya*) memanfaatkan API browser modern yang mensyaratkan origin aman (`localhost` atau protokol `https://`).

---

## 🎨 Tipografi & Desain

Platform dirancang dengan gaya visual modern, ramah pengguna, dan berstandar aksesibilitas tinggi:
- **Display, Judul & Teks Antarmuka:** `Plus Jakarta Sans` (Sans-serif modern dengan keterbacaan prima)
- **Logo & Identitas:** `Poppins` (Elemen geometris modern)
- **Palet Warna Utama:** Navy (`#0F172A`), Accent Amber (`#F59E0B`), Coral Orange (`#EA580C`), dan Soft Cream (`#FEF3C7`).

---

## 🔒 Standar Keamanan & Performa

1. **Subresource Integrity (SRI):** Pustaka Leaflet dimuat dengan hash verifikasi SHA-256 resmi dari unpkg/Leaflet.
2. **Ketergantungan Teruji:** Pustaka `supabase-js` dipin ke versi stabil `2.117.2`.
3. **Pembersihan Aset & Kompresi:** Semua aset gambar kartu dikompresi ke format generasi terbaru WebP (~100–120 KB), dan `og-image.jpg` dioptimalkan pada resolusi 1200×630 (<170 KB) agar pratinjau media sosial (WhatsApp/Facebook) tampil instan.
4. **Proteksi Injeksi:** Seluruh titik injeksi DOM (*innerHTML*) wajib melalui penyaringan fungsi `escapeHtml()`, `safeImageUrl()`, atau konversi eksplisit `Number()`.
5. **Kebijakan Basis Data RLS:** Pengunjung publik hanya dapat membaca data yang diverifikasi, sementara modifikasi status laporan hanya diizinkan bagi UID terautentikasi yang terdaftar di tabel `admins`.
6. **Privasi Foto:** Foto di-*re-encode* lewat canvas di browser (EXIF GPS/perangkat dibuang) dan dikompres sebelum diunggah ke bucket publik.
7. **Integritas Server & Otoritatif Ruas:** Nama pelapor dikunci oleh trigger dari token login; `ruas_id` dihitung secara otoritatif di server berdasarkan koordinat GPS (`set_laporan_ruas_id`) untuk mencegah manipulasi/pemalsuan dari client; serta pembatas harian 10 laporan/24 jam per akun.
8. **Kuota Penyimpanan & Trigger Storage:**
   - Sistem menetapkan batas kuota penyimpanan foto maksimal 30 berkas aktif per akun pengguna (`laporan/<uid>/...`).
   - Pada PostgreSQL lokal/mandiri, kuota dijaga ketat di level basis data melalui trigger `trg_batasi_kuota_upload` pada `storage.objects`.
   - Pada platform Supabase Managed Cloud, role `postgres` memiliki pembatasan hak istimewa pada skema internal `storage`, sehingga instalasi skrip membungkus trigger dalam blok `EXCEPTION WHEN insufficient_privilege`. Bila trigger terlewati di cloud, RLS policy hanya membatasi isolasi namespace path (`laporan/<uid>/...` agar pengguna tidak dapat menimpa/menghapus berkas pengguna lain), sedangkan batas kuantitas 30 berkas ditegakkan di antarmuka web. Pengguna yang memotong antarmuka via API langsung tidak terbatasi jumlah berkasnya jika trigger ini tidak aktif. Untuk lingkungan produksi tanpa celah bypass API, kuota storage wajib diperkuat dengan Supabase Storage Webhooks atau Edge Function.

---

## 🙏 Kredit & Atribusi

- **Ilustrasi** (`assets/img/*`): dibuat dengan AI generatif; bukan foto nyata.
- **Peta**: Leaflet (BSD-2), tile © Esri, Maxar, Earthstar Geographics, HERE, Garmin, OpenStreetMap contributors.
- **Routing**: OSRM demo server, data © OpenStreetMap contributors (ODbL).
- **Ikon**: Lucide (ISC). **CSS**: Tailwind CSS (MIT). **Font**: Plus Jakarta Sans & Poppins (OFL). **Backend**: Supabase.

---

## 📦 Paket Pengumpulan
`npm run build:css && npm run package` membuat `../JalanKitta_Pengumpulan.zip` bersih (tanpa `__MACOSX`/`.DS_Store`/`node_modules`). Lengkapi dahulu `pengumpulan/` (surat orisinalitas bertanda tangan, proposal PDF, link demo & video 2–5 menit) sesuai juknis C.7.

---

## 💡 Keputusan Desain & Catatan Produksi

1. **Pemisahan Koridor Ruas Jalan vs Aduan Warga:**
   - **`ruas_jalan` (Geometri Linier):** Merepresentasikan koridor jalan lintas kabupaten/kota. Saat ini berisi data contoh (bukan survei resmi).
   - **`laporan_warga` (Titik Geospasial Insidental):** Berfungsi sebagai kanal partisipasi publik (*crowdsourcing*) untuk menandai lubang/kerusakan spesifik. Laporan yang diselesaikan diverifikasi oleh admin secara independen dan tidak serta-merta mengubah survei resmi panjang koridor jalan sebelum pembaruan berkala dari dinas terkait.
2. **Roadmap Menuju Produksi Skala Penuh:**
   - **Pembatas Laju Lanjutan:** Trigger SQL sudah membatasi laporan/subscriber per periode; untuk produksi tambahkan Edge Function / Cloudflare Turnstile.
   - **Fitur belum ada:** rute alternatif yang menghindari ruas rusak (dapat dibangun dengan OSRM `alternatives=true`), statistik per kabupaten/kota, integrasi data instansi.
   - **Bundling Aset:** CSS sudah dibuild dengan Tailwind CLI; pustaka eksternal lain dapat dipasangi SRI lengkap.
