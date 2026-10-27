// @ts-nocheck
// supabase/functions/triase-foto/index.ts
// Supabase Deno Edge Function: Triase Foto Kerusakan Jalan dengan Google Gemini (Free Tier)
// Catatan: Model AI hanya mendeteksi posisi kotak pembatas; diameter dihitung di kode.

import { createClient } from 'npm:@supabase/supabase-js@2';

interface TriaseInput {
  foto_path: string;
  ada_a4: boolean;
}

// Ekstraksi dimensi lebar & tinggi asli dari header biner JPEG / WebP / PNG
function getImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  try {
    // 1. Format JPEG (0xFF 0xD8)
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      let offset = 2;
      const len = bytes.length;
      while (offset < len) {
        if (bytes[offset] !== 0xFF) break;
        const marker = bytes[offset + 1];
        if (
          (marker >= 0xC0 && marker <= 0xC3) ||
          (marker >= 0xC5 && marker <= 0xC7) ||
          (marker >= 0xC9 && marker <= 0xCB) ||
          (marker >= 0xCD && marker <= 0xCF)
        ) {
          if (offset + 8 < len) {
            const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
            const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
            if (width > 0 && height > 0) return { width, height };
          }
        }
        if (offset + 3 >= len) break;
        const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
        offset += 2 + segmentLength;
      }
    }

    // 2. Format WebP ('RIFF' ... 'WEBP')
    if (
      bytes.length >= 30 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      // VP8 (lossy)
      if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x20) {
        const width = ((bytes[27] << 8) | bytes[26]) & 0x3FFF;
        const height = ((bytes[29] << 8) | bytes[28]) & 0x3FFF;
        if (width > 0 && height > 0) return { width, height };
      }
      // VP8L (lossless)
      if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x4C && bytes[20] === 0x2F) {
        const b1 = bytes[21], b2 = bytes[22], b3 = bytes[23], b4 = bytes[24];
        const width = 1 + (((b2 & 0x3F) << 8) | b1);
        const height = 1 + (((b4 & 0x0F) << 10) | (b3 << 2) | ((b2 & 0xC0) >> 6));
        if (width > 0 && height > 0) return { width, height };
      }
      // VP8X (extended)
      if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x58) {
        const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        if (width > 0 && height > 0) return { width, height };
      }
    }

    // 3. Format PNG ('\x89PNG')
    if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      if (width > 0 && height > 0) return { width, height };
    }
  } catch {
    // Abaikan error pembacaan biner jika berkas tidak lazim
  }
  return null;
}

// Konversi Uint8Array ke Base64 aman dalam blok memori
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

// Validasi kotak koordinat 0..1000 [ymin, xmin, ymax, xmax]
function validateBox(box: unknown): [number, number, number, number] | null {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box.map(Number);
  if (isNaN(ymin) || isNaN(xmin) || isNaN(ymax) || isNaN(xmax)) return null;
  if (ymin < 0 || xmin < 0 || ymax > 1000 || xmax > 1000) return null;
  if (ymin >= ymax || xmin >= xmax) return null;
  return [Math.round(ymin), Math.round(xmin), Math.round(ymax), Math.round(xmax)];
}

Deno.serve(async (req: Request) => {
  // CORS: batasi ke daftar ALLOWED_ORIGINS (daftar dipisah koma)
  const allowedOriginsRaw = Deno.env.get('ALLOWED_ORIGINS') || '';
  const allowedOrigins = allowedOriginsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const requestOrigin = req.headers.get('origin') || '';

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Hanya pantulkan origin yang ada di daftar secret ALLOWED_ORIGINS
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    corsHeaders['Access-Control-Allow-Origin'] = requestOrigin;
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const jsonResponse = (body: Record<string, unknown>, status = 200) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  };

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ ok: false, alasan: 'Sesi pengguna tidak ditemukan' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || supabaseServiceKey;

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ ok: false, alasan: 'Konfigurasi server belum lengkap' });
    }

    // 1. Verifikasi token JWT pengguna
    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authErr } = await supabaseUserClient.auth.getUser();
    if (authErr || !user) {
      return jsonResponse({ ok: false, alasan: 'Sesi login tidak valid atau telah kedaluwarsa' });
    }

    // Parse input
    const body: TriaseInput = await req.json().catch(() => ({ foto_path: '', ada_a4: false }));
    const { foto_path, ada_a4 } = body;

    // 2. Validasi foto_path: harus di bucket foto_laporan di bawah direktori user sendiri
    const userFolderPrefix = `laporan/${user.id}/`;
    if (!foto_path || typeof foto_path !== 'string' || !foto_path.startsWith(userFolderPrefix) || foto_path.includes('..')) {
      return jsonResponse({ ok: false, alasan: 'Akses path foto tidak diizinkan' });
    }

    // 3. Batas kuota: maksimal 10 panggilan per user per 24 jam (fail-closed jika countErr)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: dailyCount, error: countErr } = await supabaseAdmin
      .from('ai_triase')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', oneDayAgo);

    if (countErr) {
      return jsonResponse({ ok: false, alasan: 'Gagal memverifikasi kuota pengguna' });
    }

    if ((dailyCount || 0) >= 10) {
      return jsonResponse({ ok: false, alasan: 'Batas kuota harian triase AI (10 kali per 24 jam) telah tercapai' });
    }

    // 4. Unduh gambar dari Supabase Storage (bucket foto_laporan)
    const { data: fileBlob, error: downloadErr } = await supabaseAdmin
      .storage
      .from('foto_laporan')
      .download(foto_path);

    if (downloadErr || !fileBlob) {
      return jsonResponse({ ok: false, alasan: 'Foto tidak ditemukan di penyimpanan server' });
    }

    // Tolak jika ukuran > 3 MB
    if (fileBlob.size > 3 * 1024 * 1024) {
      return jsonResponse({ ok: false, alasan: 'Ukuran foto melebihi batas 3 MB' });
    }

    const buffer = await fileBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const imgDimensions = getImageDimensions(bytes);

    // Kunci API dan Model dari Environment Secrets (tanpa default fallback)
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    const geminiModel = Deno.env.get('GEMINI_MODEL');

    if (!geminiModel) {
      return jsonResponse({ ok: false, alasan: 'Model AI belum dikonfigurasi' });
    }
    if (!geminiApiKey) {
      return jsonResponse({ ok: false, alasan: 'Kunci GEMINI_API_KEY belum disetel pada server' });
    }

    // Helper pencatatan kegagalan agar setiap panggilan Gemini terhitung kuota
    const recordFailedAttempt = async (alasanMsg: string) => {
      try {
        await supabaseAdmin.from('ai_triase').insert({
          user_id: user.id,
          foto_path,
          hasil: { gagal: true, alasan: alasanMsg },
          model: geminiModel
        });
      } catch (e) {
        console.error('Gagal mencatat log percobaan AI:', e);
      }
    };

    const mimeType = fileBlob.type || (foto_path.endsWith('.png') ? 'image/png' : foto_path.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    const base64Data = uint8ArrayToBase64(bytes);

    // 5. Prompt Ketat: Larang menebak cm; hanya posisi kotak dan kelas kualitatif
    const promptText = `
Anda adalah asisten triase foto kerusakan jalan untuk sistem informasi jalan raya.
Tugas Anda HANYA melakukan deteksi objek (bounding box) dan klasifikasi kondisi secara visual.
ATURAN KERAS:
1. Anda DILARANG KERAS menebak atau menyebutkan angka sentimeter (cm) apa pun.
2. Keluarkan HANYA JSON murni tanpa markdown, tanpa backtick, sesuai skema berikut:
{
  "adalah_foto_jalan": boolean,
  "ada_lubang": boolean,
  "kategori": "ringan" | "berat" | null,
  "deskripsi": string (maksimal 200 karakter, Bahasa Indonesia, faktual, tanpa identitas orang atau plat nomor kendaraan),
  "kedalaman_kelas": "dangkal" | "sedang" | "dalam" | "tidak_yakin",
  "kepercayaan": number (0.0 hingga 1.0),
  "catatan": string,
  "kotak_lubang": [ymin, xmin, ymax, xmax] | null,
  "kotak_a4": [ymin, xmin, ymax, xmax] | null
}
Panduan:
- Koordinat kotak dinormalisasi ke skala integer 0 sampai 1000 dengan urutan [ymin, xmin, ymax, xmax].
- Parameter pengguna menyatakan ada_a4 = ${Boolean(ada_a4)}. Nilai kotak_a4 HANYA diisi jika lembar kertas A4 benar-benar terlihat nyata di permukaan jalan di samping lubang. Jika kertas A4 tidak terlihat nyata ATAU model tidak yakin, kotak_a4 harus null; jangan menebak.
- Jika foto BUKAN foto permukaan jalan (misalnya selfie, hewan, ruangan, dokumen), set adalah_foto_jalan=false, ada_lubang=false, kategori=null, kotak_lubang=null, kotak_a4=null.
- kategori 'berat' jika lubang tampak lebar/dalam dan membahayakan kendaraan, 'ringan' jika kerusakan aspal minor/retak/amblas kecil.
`.trim();

    // Kunci API dipindahkan dari URL query string ke header 'x-goog-api-key'
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;

    // 6. Timeout 12 detik via AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    let geminiRes: Response;
    try {
      geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiApiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: promptText },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0,
            response_mime_type: 'application/json'
          }
        }),
        signal: controller.signal
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isAbort = (err as Error)?.name === 'AbortError';
      const alasanMsg = isAbort ? 'Waktu proses AI habis (>12 dtk)' : 'Gagal menghubungi layanan AI';
      await recordFailedAttempt(alasanMsg);
      return jsonResponse({ ok: false, alasan: alasanMsg });
    }
    clearTimeout(timeoutId);

    if (geminiRes.status === 429) {
      await recordFailedAttempt('Batas kuota Gemini terlampaui (HTTP 429)');
      return jsonResponse({ ok: false, alasan: 'Batas kuota gratis AI tercapai. Silakan coba beberapa saat lagi.' });
    }

    if (!geminiRes.ok) {
      await recordFailedAttempt(`Layanan AI HTTP ${geminiRes.status}`);
      return jsonResponse({ ok: false, alasan: 'Layanan AI sementara tidak dapat memproses foto' });
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      await recordFailedAttempt('Respon dari model AI kosong');
      return jsonResponse({ ok: false, alasan: 'Respon dari model AI kosong' });
    }

    // 7. Parse & Sanitasi JSON
    const cleanJson = rawText.replace(/^```json/im, '').replace(/```$/im, '').trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      await recordFailedAttempt('Format JSON respon AI tidak valid');
      return jsonResponse({ ok: false, alasan: 'Format data analisis AI tidak valid' });
    }

    const adalah_foto_jalan = Boolean(parsed.adalah_foto_jalan);
    const ada_lubang = adalah_foto_jalan ? Boolean(parsed.ada_lubang) : false;
    const kategori = (adalah_foto_jalan && (parsed.kategori === 'ringan' || parsed.kategori === 'berat')) ? parsed.kategori : null;
    const deskripsi = String(parsed.deskripsi || '').trim().slice(0, 200);
    const kedalaman_kelas = ['dangkal', 'sedang', 'dalam', 'tidak_yakin'].includes(String(parsed.kedalaman_kelas))
      ? String(parsed.kedalaman_kelas)
      : 'tidak_yakin';
    const rawKepercayaan = Number(parsed.kepercayaan);
    const kepercayaan = isNaN(rawKepercayaan) ? 0 : Math.max(0, Math.min(1, Math.round(rawKepercayaan * 100) / 100));
    const catatan = String(parsed.catatan || '').trim().slice(0, 300);

    let kotak_lubang = adalah_foto_jalan ? validateBox(parsed.kotak_lubang) : null;
    let kotak_a4 = (adalah_foto_jalan && Boolean(ada_a4)) ? validateBox(parsed.kotak_a4) : null;

    // 8. Hitung diameter DI KODE dari rasio kotak pembatas terhadap kertas A4
    let diameter_cm_min: number | null = null;
    let diameter_cm_maks: number | null = null;
    let rasio_a4: number | null = null;

    if (kotak_lubang && kotak_a4 && imgDimensions) {
      const { width: imgW, height: imgH } = imgDimensions;
      const [a4Ymin, a4Xmin, a4Ymax, a4Xmax] = kotak_a4;
      const a4W_px = ((a4Xmax - a4Xmin) / 1000) * imgW;
      const a4H_px = ((a4Ymax - a4Ymin) / 1000) * imgH;
      const sisi_panjang_px = Math.max(a4W_px, a4H_px);
      const sisi_pendek_px = Math.min(a4W_px, a4H_px);

      if (sisi_pendek_px > 0) {
        rasio_a4 = sisi_panjang_px / sisi_pendek_px;
        // Rasio kertas A4 = 29.7 / 21 = 1.414 (toleransi 0.25 -> [1.164, 1.664])
        if (rasio_a4 >= 1.164 && rasio_a4 <= 1.664) {
          const skala_cm_per_px = ((29.7 / sisi_panjang_px) + (21.0 / sisi_pendek_px)) / 2;
          const [lubYmin, lubXmin, lubYmax, lubXmax] = kotak_lubang;
          const lubW_px = ((lubXmax - lubXmin) / 1000) * imgW;
          const lubH_px = ((lubYmax - lubYmin) / 1000) * imgH;
          const lubMax_px = Math.max(lubW_px, lubH_px);
          const diameter_cm = lubMax_px * skala_cm_per_px;

          // Simpan rentang target toleransi ±20% dengan pembulatan 1 angka desimal
          diameter_cm_min = Math.round(diameter_cm * 0.8 * 10) / 10;
          diameter_cm_maks = Math.round(diameter_cm * 1.2 * 10) / 10;
        } else {
          // Rasio tidak sesuai A4 (mungkin miring ekstrem atau bukan A4)
          kotak_a4 = null;
        }
      }
    }

    const hasilRecord = {
      gagal: false,
      adalah_foto_jalan,
      ada_lubang,
      kategori,
      deskripsi,
      kedalaman_kelas,
      kepercayaan,
      catatan,
      kotak_lubang,
      kotak_a4,
      diameter_cm_min,
      diameter_cm_maks,
      rasio_a4: rasio_a4 ? Math.round(rasio_a4 * 1000) / 1000 : null
    };

    // 9. Simpan hasil triase sukses ke tabel ai_triase memakai service role
    await supabaseAdmin.from('ai_triase').insert({
      user_id: user.id,
      foto_path,
      hasil: hasilRecord,
      model: geminiModel
    });

    return jsonResponse({ ok: true, hasil: hasilRecord });
  } catch (err: unknown) {
    console.error('Triase foto error:', err);
    return jsonResponse({ ok: false, alasan: 'Terjadi kendala internal saat menganalisis foto' });
  }
});
