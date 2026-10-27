import { readFileSync } from 'node:fs';

const EXPECTED_SRI = {
  'https://unpkg.com/lucide@0.453.0/dist/umd/lucide.min.js': 'sha384-0v3Wh0ZtiQBYCYywQoeMDA5mAw5Z01p0lhorqy0BlwFrcN6u3lmN7K0U/e1uezmr',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js': 'sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js': 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js': 'sha384-eXVCORTRlv4FUUgS/xmOyr66XBVraen8ATNLMESp92FKXLAMiKkerixTiBvXriZr',
  'https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js': 'sha384-eEu5CTj3qGvu9PdJuS+YlkNi7d2XxQROAFYOr59zgObtlcux1ae1Il3u7jvdCSWu',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js': 'sha384-vsrfeLOOY6KuIYKDlmVH5UiBmgIdB1oEf7p01YgWHuqmOHfZr374+odEv96n9tNC',
};

const HTML_FILES = ['index.html', 'app.html', 'admin.html', 'login.html'];
let hasError = false;

console.log('--- Memeriksa Integritas Kode JalanKitta ---');

for (const file of HTML_FILES) {
  const content = readFileSync(file, 'utf8');

  // 1. Cek CSP
  if (!content.includes('http-equiv="Content-Security-Policy"')) {
    console.error(`❌ [${file}] Meta Content-Security-Policy tidak ditemukan.`);
    hasError = true;
  }

  // 2. Cek Skip-link
  if (!content.includes('class="skip-link"')) {
    console.error(`❌ [${file}] Skip-link accessible tidak ditemukan.`);
    hasError = true;
  }

  // 3. Cek target main-content
  if (!content.includes('id="main-content"')) {
    console.error(`❌ [${file}] Target #main-content tidak ditemukan.`);
    hasError = true;
  }

  // 4. Cek SRI ditegakkan untuk SEMUA skrip CDN eksternal
  const scriptTagRegex = /<script\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
  let match;
  while ((match = scriptTagRegex.exec(content)) !== null) {
    const fullTag = match[0];
    const srcUrl = match[1];

    if (!/\bintegrity=["'][^"']+["']/i.test(fullTag)) {
      console.error(`❌ [${file}] Skrip CDN eksternal "${srcUrl}" tidak memiliki atribut integrity (SRI)!`);
      hasError = true;
    } else {
      const integrityMatch = fullTag.match(/\bintegrity=["']([^"']+)["']/i);
      const hashInFile = integrityMatch ? integrityMatch[1] : '';
      if (EXPECTED_SRI[srcUrl] && hashInFile !== EXPECTED_SRI[srcUrl]) {
        console.error(`❌ [${file}] SRI hash untuk ${srcUrl} tidak cocok dengan hash resmi!`);
        hasError = true;
      }
    }

    if (!/\bcrossorigin=["']anonymous["']/i.test(fullTag)) {
      console.error(`❌ [${file}] Skrip CDN eksternal "${srcUrl}" wajib memiliki crossorigin="anonymous"!`);
      hasError = true;
    }
  }

  // 5. Cek sintaks JS inline
  const scripts = content.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi) || [];
  scripts.forEach((s, idx) => {
    const code = s.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
    try {
      new Function(code);
    } catch (err) {
      console.error(`❌ [${file}] Syntax error pada script inline #${idx + 1}:`, err.message);
      hasError = true;
    }
  });

  if (!hasError) {
    console.log(`✓ [${file}] Lolos verifikasi keamanan, aksesibilitas, dan sintaks.`);
  }
}

if (hasError) {
  console.error('\n❌ Ada pemeriksaan yang gagal!');
  process.exit(1);
} else {
  console.log('\n🎉 Seluruh 4 berkas HTML lolos audit otomatis!');
}
