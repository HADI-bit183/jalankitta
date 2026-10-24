// Menghasilkan supabase/seed_ruas_tambahan.sql berisi ruas jalan tambahan
// dengan geometri nyata dari OSRM (https://router.project-osrm.org).
//
// Jalankan:  node scripts/generate_seed_ruas.mjs
// Lalu jalankan isi supabase/seed_ruas_tambahan.sql di Supabase SQL Editor.
//
// CATATAN: Titik awal/akhir adalah koordinat pusat kota/kecamatan (bukan titik survei).
// Kondisi (baik/ringan/berat) adalah DATA CONTOH untuk demonstrasi prototipe,
// bukan hasil survei resmi. Jangan dipresentasikan sebagai data pemerintah.
import { writeFileSync } from 'node:fs';

// [id, nama, kabupaten, kondisi, [lngAwal, latAwal], [lngAkhir, latAkhir]]
const RUAS = [
  ['R-04', 'Ruas Bandar Lampung - Pringsewu', 'Pringsewu', 'baik', [105.2610, -5.4295], [104.9740, -5.3580]],
  ['R-05', 'Ruas Metro - Sukadana', 'Lampung Timur', 'ringan', [105.3070, -5.1130], [105.5760, -5.0580]],
  ['R-06', 'Ruas Kotabumi - Bukit Kemuning', 'Lampung Utara', 'berat', [104.9000, -4.8300], [104.7840, -4.6930]],
  ['R-07', 'Ruas Liwa - Krui', 'Pesisir Barat', 'ringan', [104.0560, -5.0170], [103.9340, -5.1920]],
  ['R-08', 'Ruas Menggala - Kotabumi', 'Tulang Bawang', 'ringan', [105.2900, -4.4660], [104.9000, -4.8300]],
  ['R-09', 'Ruas Metro - Gunung Sugih', 'Lampung Tengah', 'baik', [105.3070, -5.1130], [105.2750, -4.9900]],
  ['R-10', 'Ruas Kalianda - Bakauheni', 'Lampung Selatan', 'ringan', [105.6030, -5.7280], [105.7430, -5.8650]],
  ['R-11', 'Ruas Teluk Betung - Kalianda', 'Lampung Selatan', 'berat', [105.2590, -5.4400], [105.6030, -5.7280]],
  ['R-12', 'Ruas Kota Agung - Talang Padang', 'Tanggamus', 'berat', [104.6180, -5.4950], [104.6720, -5.3190]],
  ['R-13', 'Ruas Gedong Tataan - Pringsewu', 'Pesawaran', 'baik', [105.0870, -5.2220], [104.9740, -5.3580]],
  ['R-14', 'Ruas Bandar Lampung - Metro (Lintas Tengah)', 'Lampung Tengah', 'ringan', [105.2610, -5.4295], [105.3070, -5.1130]],
];

const esc = (s) => s.replace(/'/g, "''");
const rows = [];

for (const [id, nama, kab, kondisi, a, b] of RUAS) {
  const url = `https://router.project-osrm.org/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== 'Ok') { console.error(`GAGAL ${id}: ${data.code}`); continue; }
  const route = data.routes[0];
  // Kurangi jumlah titik (ambil tiap ke-N) agar SQL tidak terlalu besar
  const coords = route.geometry.coordinates;
  const step = Math.max(1, Math.floor(coords.length / 150));
  const slim = coords.filter((_, i) => i % step === 0 || i === coords.length - 1)
    .map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]);
  const km = (route.distance / 1000).toFixed(2);
  console.log(`${id} ${nama}: ${km} km, ${slim.length} titik`);
  const geom = JSON.stringify({ type: 'LineString', coordinates: slim });
  rows.push(`('${id}', '${esc(nama)}', '${esc(kab)}', '${kondisi}', '${kondisi}',\n '${geom}'::jsonb, ${km})`);
  await new Promise((r) => setTimeout(r, 1200)); // sopan terhadap server publik OSRM
}

const sql = `-- Ruas jalan tambahan (DATA CONTOH untuk prototipe; kondisi bukan hasil survei resmi).
-- Dihasilkan oleh scripts/generate_seed_ruas.mjs. Aman dijalankan berulang (upsert).

-- Pastikan kolom kondisi_dasar sudah ada jika berkas ini dijalankan sebelum schema.sql baru dieksekusi
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ruas_jalan' and column_name = 'kondisi_dasar'
  ) then
    alter table public.ruas_jalan add column kondisi_dasar text not null default 'baik';
  end if;
end $$;

insert into public.ruas_jalan (id, nama, kabupaten, kondisi_dasar, kondisi, geometry, panjang_km) values
${rows.join(',\n')}
on conflict (id) do update set
  nama = excluded.nama, kabupaten = excluded.kabupaten,
  kondisi_dasar = coalesce(excluded.kondisi_dasar, excluded.kondisi), kondisi = excluded.kondisi,
  geometry = excluded.geometry, panjang_km = excluded.panjang_km, updated_at = now();
`;
writeFileSync(new URL('../supabase/seed_ruas_tambahan.sql', import.meta.url), sql);
console.log(`Selesai: ${rows.length} ruas ditulis ke supabase/seed_ruas_tambahan.sql`);
