// Menambah SRI pada skrip eksternal, CSP (meta), dan skip-link ke semua halaman. Idempoten.
import { readFileSync, writeFileSync } from 'node:fs';

const SRI = {
  'https://unpkg.com/lucide@0.453.0/dist/umd/lucide.min.js': 'sha384-0v3Wh0ZtiQBYCYywQoeMDA5mAw5Z01p0lhorqy0BlwFrcN6u3lmN7K0U/e1uezmr',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js': 'sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok',
};

const CSP = [
  "default-src 'self'",
  // 'unsafe-inline' masih dibutuhkan oleh skrip inline (preload tema + logika halaman); hilang setelah dipecah ke modul.
  "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.supabase.co https://server.arcgisonline.com https://unpkg.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://router.project-osrm.org",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const SKIP = '<a href="#main-content" class="skip-link">Lewati ke konten utama</a>';

for (const f of ['index.html', 'app.html', 'login.html', 'admin.html']) {
  let s = readFileSync(f, 'utf8');
  for (const [url, hash] of Object.entries(SRI)) {
    s = s.replace(`<script src="${url}"></script>`, `<script src="${url}" integrity="${hash}" crossorigin="anonymous"></script>`);
  }
  if (!s.includes('Content-Security-Policy')) {
    s = s.replace('<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      `<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
  }
  if (!s.includes('main-content')) {
    s = s.replace(/(<body[^>]*>)/, `$1\n  ${SKIP}`);
    s = s.replace(/<main(\s|>)/, '<main id="main-content" tabindex="-1"$1');
  }
  writeFileSync(f, s);
}
console.log('ok');
