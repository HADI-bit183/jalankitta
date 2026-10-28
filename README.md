# JalanKitta — Platform Pemantauan Infrastruktur Jalan Provinsi Lampung

Purwarupa untuk **Lomba Nasional Web Desain Gematik 2026**  
Tema: *"Empowering Global Innovators for an Intelligent Future"*  
Fokus: **SDG 9 — Industri, Inovasi, dan Infrastruktur**

---

## 📌 Ringkasan Proyek

**JalanKitta** adalah platform web multi-halaman yang mengintegrasikan pemetaan spasial interaktif dan partisipasi warga (*civic tech*) untuk memantau dan mempercepat penanganan jalan rusak di Provinsi Lampung.

> **Status:** Data ruas jalan bersumber dari **survei lapangan jalan Provinsi Lampung (2026)** mencakup wilayah Lampung Timur, Pesawaran, dan Pringsewu dengan geometri via OSRM. Gambar hero dan kartu kondisi adalah **ilustrasi buatan AI**, dan daftar mitra merupakan rencana kolaborasi lintas sektor. Rute alternatif dan statistik per kabupaten/kota dapat dikembangkan lebih lanjut.

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
│   ├── schema.sql              # Skema, View, RLS, Storage, trigger keamanan
│   └── ruas_real.sql           # Data ruas jalan nyata Lampung (hasil scripts/import_ruas.mjs)
├── scripts/
│   ├── import_ruas.mjs         # Impor data ruas nyata dari data/ruas_jalan.csv -> SQL
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
   - Trigger keamanan: nama pelapor diambil dari token login, *advisory lock* transaksi anti-*race condition*, dan batas 200 subscriber/jam.
   - Data ruas jalan nyata: Jalankan [`supabase/ruas_real.sql`](supabase/ruas_real.sql) yang dihasilkan oleh `npm run import:ruas` (data survei lapangan Lampung Timur, Pesawaran, Pringsewu 2026).
> **Catatan:** Skema ini aman dijalankan berulang kali (*idempotent*), dan host pada constraint `foto_url_valid` perlu disesuaikan jika memakai proyek Supabase lain.

### 2. Konfigurasi URL Autentikasi (Redirect URLs)
1. Buka **Authentication > URL Configuration**.
2. Masukkan URL domain atau lingkungan lokal Anda pada **Redirect URLs**, contohnya:
   - `http://localhost:8080/login.html`
   - `http://localhost:8080/app.html`
   - `https://<URL-DEPLOY-ANDA>/login.html`
   - `https://<URL-DEPLOY-ANDA>/app.html`
   Atur juga **Site URL** ke URL deploy. Membuka lewat `file://` tidak didukung (redirect auth gagal) — gunakan deploy (Netlify/Vercel/GitHub Pages) atau server lokal.

### 2b. Akun Demo untuk Dewan Juri
Pendaftaran butuh verifikasi email dan SMTP bawaan Supabase terbatas, sehingga akun demo yang sudah terverifikasi (dan memiliki akses pelapor sekaligus administrator) telah disediakan langsung di halaman `login.html` (fitur klik-isi-otomatis):
- **Email Demo Juri (Pelapor & Admin):** `hadi_priono@teknokrat.ac.id`
- **Password Demo Juri:** `Hadi200628`

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

## 🤖 Fitur Triase Foto dengan AI (Google Gemini Free Tier)

Platform menyediakan fitur opsional **Triase Foto Kerusakan Jalan dengan AI** berbasis Edge Function untuk memberikan rekomendasi awal kategori kerusakan dan perkiraan diameter lubang.

### Prinsip Utama & Etika Pengukuran
- **Hanya Saran (Bukan Keputusan Otomatis):** Rekomendasi AI bersifat asistif. Pelapor dapat memilih untuk menggunakan atau mengabaikan saran, dan petugas admin tetap memverifikasi secara independen sebelum menyetujui laporan.
- **Biaya Rp0 & Aman:** Memanfaatkan paket gratis (*Free Tier*) Google Gemini API. Kunci API hanya tersimpan di *secrets* Edge Function (tidak pernah bocor ke sisi peramban/frontend).
- **Gagal dengan Anggun (*Graceful Degradation*):** Jika fungsi dinonaktifkan, batas kuota gratis habis (HTTP 429), atau terjadi *timeout* (>12 detik), formulir pelaporan tetap berfungsi normal 100% secara manual tanpa hambatan.
- **Metode Pengukuran Deterministik (Tanpa Halusinasi cm):** Model AI **dilarang menebak angka sentimeter**. Model hanya mendeteksi kotak pembatas (*bounding box*) lubang dan objek pembanding kertas A4. Diameter dihitung oleh algoritma kode berdasarkan rasio fisik kertas A4 standar (29,7 × 21,0 cm) dan disajikan dalam rentang estimasi toleransi ±20% (misal "25–35 cm"). Kedalaman disajikan murni dalam kelas kualitatif (*dangkal, sedang, dalam, tidak yakin*) tanpa angka sentimeter rekaan.
- **Kepatuhan CSP & Keamanan CORS:** Aturan *Content Security Policy* (`connect-src`) pada seluruh halaman mengizinkan `https://*.supabase.co`, dan Edge Function hanya merespons origin yang terdaftar di secret `ALLOWED_ORIGINS`.

### Panduan Setup & Deploy Edge Function
1. Dapatkan API Key gratis di [Google AI Studio](https://aistudio.google.com).
2. Pasang Supabase CLI di komputer Anda (bila belum terpasang):
   ```bash
   npm install -g supabase
   ```
3. Login dan tautkan (*link*) ke proyek Supabase Anda:
   ```bash
   supabase login
   supabase link --project-ref <PROJECT_REF_ANDA>
   ```
4. Setel secrets kunci API, nama model, origin yang diizinkan, dan token cron pada Supabase:
   ```bash
   supabase secrets set GEMINI_API_KEY="<KUNCI_API_GEMINI_ANDA>" \
     GEMINI_MODEL="<NAMA_MODEL_DARI_AI_STUDIO>" \
     ALLOWED_ORIGINS="http://localhost:8080,https://<DOMAIN-ANDA>" \
     CRON_SECRET="kunci-rahasia-cron-anda"
   ```
   > **Catatan Konfigurasi:**  
   > - **`GEMINI_MODEL`:** Wajib diisi dengan nama model aktif dari dokumentasi Google AI Studio (misal: `gemini-3.5-flash-lite`).  
   > - **`ALLOWED_ORIGINS`:** Wajib diisi dan harus memuat origin domain tempat situs JalanKitta dihosting (bukan domain `*.supabase.co`) dan tanpa garis miring (*slash*) di akhir (contoh yang benar: `http://localhost:8080,https://jalankitta.web.app`, bukan `https://jalankitta.web.app/`). Jangan menambahkan domain `*.supabase.co` karena `ALLOWED_ORIGINS` digunakan untuk memverifikasi asal peramban klien yang memanggil Edge Function.

5. Deploy Edge Function:
   ```bash
   supabase functions deploy triase-foto
   supabase functions deploy bersihkan-yatim --no-verify-jwt
   ```
   > **Catatan Autentikasi Function:**  
   > - `triase-foto` mewajibkan token JWT pengguna (`verify_jwt = true`).  
   > - `bersihkan-yatim` dideploy dengan opsi `--no-verify-jwt` (didefinisikan di `supabase/config.toml`) karena function ini tidak dipanggil oleh pengguna aplikasi, melainkan oleh scheduler/cron dan dilindungi menggunakan secret `CRON_SECRET` (bukan JWT pengguna).

### Pembersihan Berkas Storage Yatim
Pembersihan foto pra-unggah di bucket `foto_laporan` yang berumur > 24 jam dan tidak terhubung ke laporan warga mana pun ditangani secara aman oleh Edge Function `supabase/functions/bersihkan-yatim/index.ts` menggunakan Supabase Storage API dan hak akses *Service Role*. Fungsi SQL pendamping `public.bersihkan_foto_yatim()` di [`supabase/schema.sql`](supabase/schema.sql) bertindak mengidentifikasi daftar path berkas yatim (*SELECT-only*) dan hak eksekusinya dibatasi khusus untuk `service_role`.

Fungsi dilindungi oleh secret `CRON_SECRET` melalui header `Authorization: Bearer <CRON_SECRET>`.

> Bagi pengguna lama yang sebelumnya telah memasang jadwal cron SQL lama, batalkan jadwal lama tersebut terlebih dahulu:  
> `select cron.unschedule('bersihkan_foto_yatim_daily');`

#### 1. Penjadwalan Otomatis (pg_cron + pg_net)
Jika ekstensi `pg_cron` dan `pg_net` aktif di proyek Supabase Anda (menu **Database > Extensions**), jadwalkan pembersihan otomatis (misal setiap hari pukul 03.00 WIB) via SQL Editor:
```sql
select cron.schedule(
  'bersihkan-foto-yatim-harian',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT-REF>.supabase.co/functions/v1/bersihkan-yatim',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <CRON_SECRET_ANDA>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

#### 2. Menjalankan Pembersihan Manual
Pembersihan dapat dipicu kapan saja melalui terminal / cURL:
```bash
curl -i -X POST "https://<PROJECT-REF>.supabase.co/functions/v1/bersihkan-yatim" \
  -H "Authorization: Bearer <CRON_SECRET_ANDA>"
```

#### 3. Cara Menguji Pembersihan
1. **Unggah Foto Uji:** Unggah satu berkas foto uji ke bucket `foto_laporan` di bawah folder `laporan/<uid>/test-yatim.jpg` (bisa lewat formulir lapor tanpa menekan submit laporan, atau melalui menu *Storage* di Supabase Dashboard).
2. **Ubah Umur Berkas (> 24 Jam):** Jalankan perintah SQL berikut di SQL Editor Supabase untuk memundurkan waktu pembuatan objek:
   ```sql
   update storage.objects
   set created_at = now() - interval '25 hours'
   where bucket_id = 'foto_laporan' and name like '%test-yatim.jpg';
   ```
3. **Jalankan Fungsi Pembersih:** Eksekusi function via cURL (seperti pada langkah manual di atas).
4. **Verifikasi:** Pastikan respons JSON mengembalikan status `ok: true` dan memuat path `laporan/<uid>/test-yatim.jpg` pada daftar `terhapus`. Periksa juga di menu Storage Supabase bahwa berkas tersebut telah hilang dari bucket.

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
7. **Integritas Server & Otoritatif Ruas:** Nama pelapor dikunci oleh trigger dari token login; `ruas_id` dihitung secara otoritatif di server berdasarkan koordinat GPS (`set_laporan_ruas_id` via PostGIS / fallback geometrik) untuk mencegah manipulasi/pemalsuan dari client; serta penguncian transaksi spasial (*advisory xact lock*) untuk mencegah *race condition* laporan ganda.
8. **Kuota Penyimpanan & Trigger Storage:**
   - Sistem menetapkan batas kuota penyimpanan foto maksimal 30 berkas aktif per akun pengguna (`laporan/<uid>/...`).
   - Pada PostgreSQL lokal/mandiri, kuota dijaga ketat di level basis data melalui trigger `trg_batasi_kuota_upload` pada `storage.objects`.
   - Pada platform Supabase Managed Cloud, role `postgres` memiliki pembatasan hak istimewa pada skema internal `storage`, sehingga instalasi skrip membungkus trigger dalam blok `EXCEPTION WHEN insufficient_privilege`. Bila trigger terlewati di cloud, RLS policy hanya membatasi isolasi namespace path (`laporan/<uid>/...` agar pengguna tidak dapat menimpa/menghapus berkas pengguna lain), sedangkan batas kuantitas 30 berkas ditegakkan di antarmuka web. Pengguna yang memotong antarmuka via API langsung tidak terbatasi jumlah berkasnya jika trigger ini tidak aktif. Untuk lingkungan produksi tanpa celah bypass API, kuota storage wajib diperkuat dengan Supabase Storage Webhooks atau Edge Function.

---

## 🙏 Kredit & Atribusi

- **Ilustrasi** (`assets/img/*`): dibuat dengan AI generatif; bukan foto nyata.
- **Peta**: Leaflet (BSD-2), MarkerCluster (MIT), citra satelit hibrida © Google, Maxar, CNES/Airbus, OpenStreetMap contributors.
- **Routing**: OSRM demo server, data © OpenStreetMap contributors (ODbL).
- **Ikon**: Lucide (ISC). **CSS**: Tailwind CSS (MIT). **Font**: Plus Jakarta Sans & Poppins (OFL). **Backend**: Supabase.

---

## 📦 Paket Pengumpulan
`npm run build:css && npm run package` membuat `../JalanKitta_Pengumpulan.zip` bersih (tanpa `__MACOSX`/`.DS_Store`/`node_modules`). Lengkapi dahulu `pengumpulan/` (surat orisinalitas bertanda tangan, proposal PDF, link demo & video 2–5 menit) sesuai juknis C.7.

---

## 💡 Keputusan Desain & Catatan Produksi

1. **Pemisahan Koridor Ruas Jalan vs Aduan Warga:**
   - **`ruas_jalan` (Geometri Linier):** Merepresentasikan koridor jalan lintas kabupaten/kota bersumber dari survei lapangan Provinsi Lampung (2026).
   - **`laporan_warga` (Titik Geospasial Insidental):** Berfungsi sebagai kanal partisipasi publik (*crowdsourcing*) untuk menandai lubang/kerusakan spesifik. Laporan yang diselesaikan diverifikasi oleh admin secara independen dan tidak serta-merta mengubah survei resmi panjang koridor jalan sebelum pembaruan berkala dari dinas terkait.
2. **Roadmap Menuju Produksi Skala Penuh:**
   - **Pembatas Laju Lanjutan:** Trigger SQL sudah membatasi laporan/subscriber per periode; untuk produksi tambahkan Edge Function / Cloudflare Turnstile.
   - **Fitur belum ada:** rute alternatif yang menghindari ruas rusak (dapat dibangun dengan OSRM `alternatives=true`), statistik per kabupaten/kota, integrasi data instansi.
   - **Bundling Aset:** CSS sudah dibuild dengan Tailwind CLI; pustaka eksternal lain dapat dipasangi SRI lengkap.
