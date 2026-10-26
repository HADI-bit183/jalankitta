# Proposal Proyek JalanKitta — DRAFT KERANGKA

> Kerangka isi. Lengkapi bagian bertanda _(isi)_ dan ekspor ke PDF sesuai format juknis.

## 1. Identitas Tim
_(isi)_

## 2. Latar Belakang & Masalah
Kerusakan jalan di Provinsi Lampung memengaruhi konektivitas dan keselamatan. Pelaporan warga terpecah dan sulit dipantau. _(tambahkan sumber data/berita yang dapat diverifikasi)_

## 3. Kesesuaian Tema & SDG
- Tema: **"Empowering Global Innovators for an Intelligent Future"** — warga sebagai sensor partisipatif, dipadukan peta interaktif dan routing berbasis data terbuka.
- **SDG 9** (Industri, Inovasi & Infrastruktur): target 9.1 (infrastruktur andal) dan 9.c (akses teknologi informasi).

## 4. Solusi & Fitur (hanya yang benar-benar ada)
1. Peta interaktif ruas jalan berkode warna kondisi (Leaflet + Esri), filter kondisi, mode satelit.
2. Garis ruas mengikuti jalan sebenarnya (OSRM).
3. Pelaporan warga: login, lokasi (klik peta / tombol Lokasi Saya), foto (EXIF dihapus & dikompres di browser), verifikasi admin.
4. Portal admin: verifikasi, proses, selesai, hapus laporan.
5. Statistik publik dari database.

**Belum ada / rencana pengembangan:** rute alternatif menghindari ruas rusak, statistik per kabupaten/kota, integrasi data dinas, kolaborasi dengan instansi (belum ada kemitraan).

## 5. Arsitektur & Keamanan
HTML + Tailwind (build CLI) + JS; Supabase (PostgreSQL, Auth, Storage). RLS, view publik dengan nama disamarkan, trigger integritas, pembatas harian, nama diambil dari token.

## 6. Data & Sumber
Data ruas = Survei Lapangan Jalan Provinsi Lampung 2026 (Lampung Timur, Pesawaran, Pringsewu); geometri linier OSRM/OpenStreetMap; kondisi bersumber dari pendataan lapangan aktual. Ilustrasi dibuat dengan AI (lihat Surat Orisinalitas).

## 7. Akses Demo (untuk juri)
- URL situs: _(isi URL deploy)_
- Akun pelapor demo: _(email / password)_
- Akun admin demo: _(email / password)_
- Video demo 2–5 menit: _(isi URL)_

## 8. Rencana Pengembangan
_(isi)_

## 9. Kredit
Leaflet, Esri, OpenStreetMap/OSRM, Lucide, Tailwind CSS, Supabase, Google Fonts.
