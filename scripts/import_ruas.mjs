// scripts/import_ruas.mjs
// Membaca file data nyata dari pemilik (data/ruas_jalan.csv) dan
// menghasilkan SQL upsert ke public.ruas_jalan dengan geometri nyata dari OSRM.
//
// Jalankan:  node scripts/import_ruas.mjs
// Hasil:     supabase/ruas_real.sql

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CSV_PATH = join(__dirname, '../data/ruas_jalan.csv');
const OUTPUT_SQL_PATH = join(__dirname, '../supabase/ruas_real.sql');

// Konstanta sumber data untuk header SQL (silakan diisi sendiri jika diperlukan)
const SUMBER_DATA = 'Data Teknis Ruas Jalan';

// Pemetaan koridor spasial koordinat awal & akhir berdasarkan nama ruas nyata.
// Mendukung field opsional `via`: array koordinat titik antara [[lon, lat], ...] agar rute presisi.
const CORRIDORS = {
  'jalan a.h nasution': {
    coords: [[105.3200, -5.1150], [105.3400, -5.1020]],
    formattedName: 'Jalan A.H. Nasution',
    formattedKab: 'Lampung Timur'
  },
  'jalan raya batanghari nuban': {
    coords: [[105.3750, -5.0760], [105.3880, -5.0700]],
    formattedName: 'Jalan Raya Batanghari Nuban',
    formattedKab: 'Lampung Timur'
  },
  'jalan raya sukadana': {
    coords: [[105.5420, -5.0650], [105.5700, -5.0560]],
    formattedName: 'Jalan Raya Sukadana',
    formattedKab: 'Lampung Timur'
  },
  'jalan lintas barat simpang tugu pengantin': {
    coords: [[105.0880, -5.3940], [105.0960, -5.3925]],
    formattedName: 'Jalan Lintas Barat Simpang Tugu Pengantin',
    formattedKab: 'Pesawaran'
  },
  'jalan lintas barat': {
    coords: [[105.0300, -5.3640], [104.8700, -5.4120]],
    formattedName: 'Jalan Lintas Barat',
    formattedKab: 'Pringsewu'
  },
  'jalan raya ruas pringsewu': {
    coords: [[104.9660, -5.3640], [104.9800, -5.3380]],
    formattedName: 'Jalan Raya Ruas Pringsewu',
    formattedKab: 'Pringsewu'
  }
};

const esc = (s) => s.replace(/'/g, "''");

// Menghitung panjang rute koordinat menggunakan formula Haversine (km)
function haversineDistanceKm(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  const R = 6371; // radius bumi dalam km
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    total += R * c;
  }
  return total;
}

function parseCSV(content) {
  const lines = content.trim().split('\n');
  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Format: "Format Kalimat",Nama Ruas,Wilayah,Panjang (km),Kondisi
    // Regex parsing untuk menangani kolom ber-quote
    const match = line.match(/^"([^"]*)",([^,]+),([^,]+),([^,]+),([^,]+)$/);
    if (match) {
      items.push({
        nama: match[2].trim(),
        wilayah: match[3].trim(),
        panjang: parseFloat(match[4].trim()),
        kondisi: match[5].trim().toLowerCase()
      });
    } else {
      const parts = line.split(',');
      if (parts.length >= 4) {
        items.push({
          nama: parts[parts.length - 4].trim(),
          wilayah: parts[parts.length - 3].trim(),
          panjang: parseFloat(parts[parts.length - 2].trim()),
          kondisi: parts[parts.length - 1].trim().toLowerCase()
        });
      }
    }
  }
  return items;
}

async function main() {
  console.log('--- Mengimpor Data Ruas Jalan Nyata Pemilik ---');
  const csvContent = readFileSync(CSV_PATH, 'utf8');
  const items = parseCSV(csvContent);
  console.log(`Ditemukan ${items.length} ruas jalan di CSV.`);

  const rows = [];
  const insertedIds = [];
  let index = 1;

  for (const item of items) {
    const key = item.nama.toLowerCase();
    const corridor = CORRIDORS[key];
    const id = `R-0${index++}`;
    insertedIds.push(id);
    const nama = corridor?.formattedName || item.nama;
    const kab = corridor?.formattedKab || item.wilayah;
    const panjangKm = item.panjang; // Nilai asli dari CSV tidak diubah secara diam-diam
    // Konversi kondisi sesuai check constraint database: in ('baik', 'ringan', 'berat')
    const kondisiDb = item.kondisi === 'rusak' ? 'berat' : (item.kondisi || 'berat');

    let geom;
    if (corridor) {
      const waypoints = [
        corridor.coords[0],
        ...(Array.isArray(corridor.via) ? corridor.via : []),
        corridor.coords[1]
      ];
      const coordsQuery = waypoints.map(([lon, lat]) => `${lon},${lat}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/driving/${coordsQuery}?overview=full&geometries=geojson`;
      try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.code === 'Ok' && data.routes?.length > 0) {
          const coords = data.routes[0].geometry.coordinates;

          // Hitung panjang geometri dengan haversine
          const geomLengthKm = haversineDistanceKm(coords);
          const diffPercent = (Math.abs(geomLengthKm - panjangKm) / panjangKm) * 100;
          if (diffPercent > 20) {
            console.warn(
              `⚠️ [PERINGATAN] [${id}] ${nama}: Selisih panjang geometri (${geomLengthKm.toFixed(2)} km) dengan CSV (${panjangKm} km) adalah ${diffPercent.toFixed(1)}% (> 20%)`
            );
          }

          const step = Math.max(1, Math.floor(coords.length / 150));
          const slim = coords
            .filter((_, i) => i % step === 0 || i === coords.length - 1)
            .map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]);
          geom = JSON.stringify({ type: 'LineString', coordinates: slim });
          console.log(`✓ [${id}] ${nama} (${kab}) - CSV: ${panjangKm} km, Geometri: ${geomLengthKm.toFixed(2)} km (${slim.length} titik koordinat OSRM)`);
        }
      } catch (err) {
        console.warn(`! Gagal menghubungi OSRM untuk ${nama}:`, err.message);
      }
    }

    if (!geom && corridor) {
      const waypoints = [
        corridor.coords[0],
        ...(Array.isArray(corridor.via) ? corridor.via : []),
        corridor.coords[1]
      ];
      geom = JSON.stringify({ type: 'LineString', coordinates: waypoints });
      const geomLengthKm = haversineDistanceKm(waypoints);
      const diffPercent = (Math.abs(geomLengthKm - panjangKm) / panjangKm) * 100;
      if (diffPercent > 20) {
        console.warn(
          `⚠️ [PERINGATAN] [${id}] ${nama}: Selisih panjang geometri fallback (${geomLengthKm.toFixed(2)} km) dengan CSV (${panjangKm} km) adalah ${diffPercent.toFixed(1)}% (> 20%)`
        );
      }
    }

    rows.push(`('${id}', '${esc(nama)}', '${esc(kab)}', '${kondisiDb}', '${kondisiDb}',\n '${geom}'::jsonb, ${panjangKm})`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  const idListSql = insertedIds.map((id) => `'${id}'`).join(', ');

  const sql = `-- Ruas Jalan Nyata Provinsi Lampung (${SUMBER_DATA})
-- Sumber Data: Pemilik Proyek JalanKitta / Wilayah Lampung Timur, Pesawaran, Pringsewu
-- Dihasilkan oleh scripts/import_ruas.mjs. Aman dijalankan berulang (upsert idempoten).

insert into public.ruas_jalan (id, nama, kabupaten, kondisi_dasar, kondisi, geometry, panjang_km) values
${rows.join(',\n')}
on conflict (id) do update set
  nama = excluded.nama,
  kabupaten = excluded.kabupaten,
  kondisi_dasar = coalesce(excluded.kondisi_dasar, excluded.kondisi),
  kondisi = excluded.kondisi,
  geometry = excluded.geometry,
  panjang_km = excluded.panjang_km,
  updated_at = now();

delete from public.ruas_jalan where id not in (${idListSql});
`;

  writeFileSync(OUTPUT_SQL_PATH, sql, 'utf8');
  console.log(`\n🎉 Selesai! ${rows.length} ruas ditulis ke supabase/ruas_real.sql`);
}

main().catch(err => {
  console.error('Terjadi kesalahan:', err);
  process.exit(1);
});
