#!/usr/bin/env bash
# Deploy Edge Functions JalanKitta ke Supabase
# Prasyarat: Jalankan `npx supabase login` terlebih dahulu satu kali di terminal Anda.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$ROOT/.env" ]; then
  echo "Error: Berkas .env tidak ditemukan di $ROOT" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ROOT/.env"
set +a

# Validasi variabel yang diperlukan tanpa mencetak nilainya
MISSING_VARS=()
[ -z "${SUPABASE_PROJECT_REF:-}" ] && MISSING_VARS+=("SUPABASE_PROJECT_REF")
[ -z "${GEMINI_API_KEY:-}" ] && MISSING_VARS+=("GEMINI_API_KEY")
[ -z "${GEMINI_MODEL:-}" ] && MISSING_VARS+=("GEMINI_MODEL")
[ -z "${ALLOWED_ORIGINS:-}" ] && MISSING_VARS+=("ALLOWED_ORIGINS")
[ -z "${CRON_SECRET:-}" ] && MISSING_VARS+=("CRON_SECRET")

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
  echo "Error: Variabel lingkungan berikut wajib diisi di .env: ${MISSING_VARS[*]}" >&2
  exit 1
fi

echo "=== [1/3] Menghubungkan ke Proyek Supabase (${SUPABASE_PROJECT_REF}) ==="
npx -y supabase link --project-ref "$SUPABASE_PROJECT_REF"

echo "=== [2/3] Menyimpan Secrets ke Supabase (Nilai rahasia tidak dicetak) ==="
npx -y supabase secrets set \
  GEMINI_API_KEY="$GEMINI_API_KEY" \
  GEMINI_MODEL="$GEMINI_MODEL" \
  ALLOWED_ORIGINS="$ALLOWED_ORIGINS" \
  CRON_SECRET="$CRON_SECRET"

echo "=== [3/3] Men-deploy Edge Functions ==="
echo "Deploying triase-foto..."
npx -y supabase functions deploy triase-foto

echo "Deploying bersihkan-yatim..."
npx -y supabase functions deploy bersihkan-yatim --no-verify-jwt

echo "=== Selesai! Semua Edge Function dan Secrets berhasil di-deploy ==="
