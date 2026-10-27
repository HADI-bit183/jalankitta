// @ts-nocheck
// supabase/functions/bersihkan-yatim/index.ts
// Supabase Deno Edge Function: Pembersih Foto Storage Yatim (Orphaned Files)
// Menghapus berkas pra-unggah di bucket 'foto_laporan' (pola 'laporan/*') yang berumur > 24 jam
// dan tidak terhubung ke laporan_warga.foto_url, menggunakan Supabase Storage API & Service Role.

import { createClient } from 'npm:@supabase/supabase-js@2';

// Perbandingan konstan-waktu (constant-time comparison) untuk mencegah timing attack:
// Hash SHA-256 kedua nilai lalu bandingkan byte per byte.
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const hashA = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(a)));
  const hashB = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(b)));

  let mismatch = 0;
  for (let i = 0; i < hashA.length; i++) {
    mismatch |= hashA[i] ^ hashB[i];
  }
  return mismatch === 0;
}

Deno.serve(async (req: Request) => {
  // Tangani preflight OPTIONS bila dipanggil dari client / dashboard
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
    });
  }

  // 1. Validasi CRON_SECRET pada header Authorization secara constant-time
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Secret CRON_SECRET belum diset di Supabase secrets.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  const isAuthorized = token.length > 0 && (await timingSafeEqual(token, cronSecret));
  if (!isAuthorized) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Unauthorized: Header Authorization tidak valid atau tidak cocok dengan CRON_SECRET.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 2. Kredensial Service Role
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Variabel lingkungan SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    let pathsToClean: string[] = [];
    let sumberMetode = 'rpc_bersihkan_foto_yatim';

    // 3. Ambil daftar foto yatim: utamakan fungsi SQL bersihkan_foto_yatim (SELECT saja)
    const { data: rpcData, error: rpcErr } = await supabase.rpc('bersihkan_foto_yatim');

    if (!rpcErr && Array.isArray(rpcData)) {
      pathsToClean = rpcData
        .map((row: any) => (typeof row === 'string' ? row : row?.name))
        .filter((name: any): name is string => typeof name === 'string' && name.length > 0);
    } else {
      console.warn('RPC bersihkan_foto_yatim gagal atau tidak tersedia, beralih ke inspeksi manual via Storage API:', rpcErr);
      sumberMetode = 'fallback_storage_api';

      // Fallback: periksa tabel laporan_warga
      const { data: laporanRows, error: lapErr } = await supabase
        .from('laporan_warga')
        .select('foto_url')
        .is('deleted_at', null)
        .not('foto_url', 'is', null);

      if (lapErr) {
        return new Response(
          JSON.stringify({ ok: false, error: `Gagal membaca laporan_warga: ${lapErr.message}` }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const activeUrls = (laporanRows || [])
        .map((r: any) => r.foto_url)
        .filter((url: any): url is string => typeof url === 'string');

      // Ambil folder-folder user di bawah direktori 'laporan'
      const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const { data: userFolders, error: folderErr } = await supabase.storage.from('foto_laporan').list('laporan');

      if (!folderErr && Array.isArray(userFolders)) {
        for (const folder of userFolders) {
          if (!folder.name) continue;
          const folderPrefix = `laporan/${folder.name}`;
          const { data: files, error: fileErr } = await supabase.storage.from('foto_laporan').list(folderPrefix);

          if (!fileErr && Array.isArray(files)) {
            for (const file of files) {
              if (!file.name) continue;
              const fullPath = `${folderPrefix}/${file.name}`;
              const createdAt = file.created_at ? new Date(file.created_at) : null;

              if (createdAt && createdAt < cutoffTime) {
                // Periksa apakah dirujuk di laporan_warga.foto_url
                const isReferenced = activeUrls.some((url) => url.includes(fullPath) || url.includes(file.name));
                if (!isReferenced) {
                  pathsToClean.push(fullPath);
                }
              }
            }
          }
        }
      }
    }

    // 4. Jika tidak ada berkas yatim
    if (pathsToClean.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          pesan: 'Tidak ada foto yatim berumur > 24 jam yang ditemukan.',
          metode: sumberMetode,
          jumlah_ditemukan: 0,
          terhapus: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 5. Hapus berkas lewat Supabase Storage API (batch per 100 objek)
    const batchSize = 100;
    const deletedList: string[] = [];
    const failedList: { path: string; error: string }[] = [];

    for (let i = 0; i < pathsToClean.length; i += batchSize) {
      const batch = pathsToClean.slice(i, i + batchSize);
      const { data: removed, error: removeErr } = await supabase.storage.from('foto_laporan').remove(batch);

      if (removeErr) {
        console.error('Gagal menghapus batch foto dari Storage:', removeErr);
        for (const p of batch) {
          failedList.push({ path: p, error: removeErr.message });
        }
      } else if (Array.isArray(removed)) {
        for (const item of removed) {
          const name = typeof item === 'string' ? item : item?.name;
          if (name) deletedList.push(name);
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        pesan: `Pembersihan berhasil. ${deletedList.length} dari ${pathsToClean.length} berkas yatim telah dihapus.`,
        metode: sumberMetode,
        jumlah_ditemukan: pathsToClean.length,
        terhapus: deletedList,
        gagal: failedList,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('Kesalahan tak terduga pada pembersih foto yatim:', errorMsg);
    return new Response(
      JSON.stringify({ ok: false, error: `Kesalahan server internal: ${errorMsg}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
