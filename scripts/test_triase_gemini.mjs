import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Baca konfigurasi dari .env jika ada
const env = {};
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let value = match[2] || '';
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[match[1]] = value;
    }
  }
}

const geminiApiKey = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL || env.GEMINI_MODEL;

// 2. Validasi kredensial tanpa crash
if (!geminiApiKey) {
  console.error('Error: Kunci GEMINI_API_KEY tidak ditemukan di .env atau environment.');
  process.exit(1);
}
if (!geminiModel) {
  console.error('Error: Nama GEMINI_MODEL tidak ditemukan di .env atau environment.');
  process.exit(1);
}

console.log('--- Uji Coba Triase Foto JalanKitta dengan Gemini API ---');
console.log(`Model    : ${geminiModel}`);
console.log('API Key  : terisi');

// 3. Parsing Argumen CLI
const rawArgs = process.argv.slice(2);
const isA4 = rawArgs.includes('--a4');
const nonFlagArgs = rawArgs.filter(arg => !arg.startsWith('--'));
const inputFolder = nonFlagArgs[0] || './test_fotos';
const targetDir = path.isAbsolute(inputFolder) ? inputFolder : path.resolve(rootDir, inputFolder);

console.log(`Folder   : ${inputFolder}`);
console.log(`Mode A4  : ${isA4 ? 'Ya (--a4 aktif)' : 'Tidak (standar)'}`);

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const validExtensions = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

const entries = fs.readdirSync(targetDir);
const imageFiles = entries.filter(f => {
  const ext = path.extname(f).toLowerCase();
  return Object.prototype.hasOwnProperty.call(validExtensions, ext);
});

const outputPath = path.join(targetDir, 'hasil_uji.json');

if (imageFiles.length === 0) {
  console.log(`\nTidak ditemukan berkas foto (.jpg, .jpeg, .png, .webp) di direktori "${inputFolder}".`);
  console.log('Silakan masukkan berkas foto ke dalam folder tersebut untuk diuji.');
  fs.writeFileSync(outputPath, JSON.stringify([], null, 2), 'utf8');
  console.log(`Berkas ringkasan tersimpan di: ${outputPath}`);
  process.exit(0);
}

// 4. Susun Prompt Triase
const a4Instruction = isA4
  ? '- Parameter pengguna menyatakan ada_a4 = true. Pelapor menyertakan lembar kertas A4 standar (29,7 × 21,0 cm) sebagai pembanding ukuran di samping lubang. Cari lembar kertas A4 putih tersebut dan tandai kotak_a4: [ymin, xmin, ymax, xmax]. Jika tidak terlihat jelas, kotak_a4: null.'
  : '- Parameter pengguna menyatakan ada_a4 = false. Nilai kotak_a4 HANYA diisi jika lembar kertas A4 benar-benar terlihat nyata di permukaan jalan di samping lubang. Jika kertas A4 tidak terlihat nyata ATAU model tidak yakin, kotak_a4 harus null; jangan menebak.';

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
${a4Instruction}
- Jika foto BUKAN foto permukaan jalan (misalnya selfie, hewan, ruangan, dokumen), set adalah_foto_jalan=false, ada_lubang=false, kategori=null, kotak_lubang=null, kotak_a4=null.
- kategori 'berat' jika lubang tampak lebar/dalam dan membahayakan kendaraan, 'ringan' jika kerusakan aspal minor/retak/amblas kecil.
`.trim();

// 5. Eksekusi Pengujian Tiap Foto
const results = [];

for (const imageFile of imageFiles) {
  const filePath = path.join(targetDir, imageFile);
  const ext = path.extname(imageFile).toLowerCase();
  const mimeType = validExtensions[ext] || 'image/jpeg';

  console.log(`\n[Menguji]: ${imageFile} (${mimeType})`);

  const fileBytes = fs.readFileSync(filePath);
  const base64Data = fileBytes.toString('base64');
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;

  const startTime = Date.now();
  let statusHttp = 0;
  let duration = 0;
  let parsedResult = null;
  let errorMsg = null;

  try {
    const res = await fetch(geminiUrl, {
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
      })
    });

    statusHttp = res.status;
    duration = Date.now() - startTime;
    console.log(`Status HTTP: ${statusHttp} (${duration} ms)`);

    if (!res.ok) {
      errorMsg = await res.text();
      console.error('Error dari API Gemini:', errorMsg);
    } else {
      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      try {
        parsedResult = JSON.parse(rawText);
        console.log('Hasil Analisis AI:');
        console.log(JSON.stringify(parsedResult, null, 2));
      } catch {
        errorMsg = `Respon bukan JSON valid: ${rawText}`;
        console.error(errorMsg);
      }
    }
  } catch (err) {
    duration = Date.now() - startTime;
    errorMsg = err.message;
    console.error(`Gagal melakukan request: ${err.message}`);
  }

  results.push({
    berkas: imageFile,
    waktu_uji: new Date().toISOString(),
    status_http: statusHttp,
    durasi_ms: duration,
    ada_a4_flag: isA4,
    sukses: !errorMsg && !!parsedResult,
    hasil: parsedResult,
    error: errorMsg
  });
}

// 6. Simpan hasil tanpa menyertakan kunci API
fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
console.log(`\n✅ Seluruh pengujian selesai. Hasil disimpan di: ${outputPath}`);
