#!/usr/bin/env bash
# Membuat paket pengumpulan (juknis C.7) yang bersih dari sampah macOS, node_modules, dan berkas rahasia.
# Pakai:  npm run build:css && bash scripts/package.sh
# Hasil:  ../JalanKitta_Pengumpulan.zip berisi:
#   1_Folder_Karya/      (kode situs)
#   2_Surat_Orisinalitas/ (taruh PDF bertanda tangan di sini sebelum zip)
#   3_Proposal_Proyek/    (taruh PDF proposal di sini)
#   4_Link_Demo.txt       (isi URL deploy + URL video demo)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)/JalanKitta_Pengumpulan"
OUT="$ROOT/JalanKitta_Pengumpulan.zip"
OUT_CODE="$ROOT/1_Folder_Karya.zip"

mkdir -p "$STAGE/1_Folder_Karya" "$STAGE/2_Surat_Orisinalitas" "$STAGE/3_Proposal_Proyek"
rsync -a \
  --include '.env.example' \
  --exclude '*.zip' \
  --exclude 'node_modules' --exclude '.git' --exclude '.DS_Store' --exclude '__MACOSX' \
  --exclude '._*' --exclude 'pengumpulan' --exclude '.env*' --exclude '*.env*' \
  --exclude 'supabase/.temp' --exclude 'supabase/.temp/*' \
  --exclude 'supabase/.env.local' --exclude 'test_fotos*' \
  "$ROOT/" "$STAGE/1_Folder_Karya/"

# Salin draf/berkas dari folder pengumpulan/ bila sudah ada PDF final
cp "$ROOT"/pengumpulan/*.pdf "$STAGE/2_Surat_Orisinalitas/" 2>/dev/null || true
cp "$ROOT/pengumpulan/Link_Demo.txt" "$STAGE/4_Link_Demo.txt" 2>/dev/null || \
  cp "$ROOT/pengumpulan/Link_Demo.template.txt" "$STAGE/4_Link_Demo.txt"
cp "$ROOT/pengumpulan/Proposal_Proyek_DRAFT.md" "$STAGE/3_Proposal_Proyek/" 2>/dev/null || true
cp "$ROOT/pengumpulan/Surat_Orisinalitas_DRAFT.md" "$STAGE/2_Surat_Orisinalitas/" 2>/dev/null || true

rm -f "$OUT" "$OUT_CODE"
( cd "$(dirname "$STAGE")" && zip -rq "$OUT" "JalanKitta_Pengumpulan" \
  -x '*.DS_Store' '*__MACOSX*' '*supabase/.temp*' '*supabase/.env.local*' '*test_fotos*' )
( cd "$STAGE" && zip -rq "$OUT_CODE" "1_Folder_Karya" \
  -x '*.DS_Store' '*__MACOSX*' '*supabase/.temp*' '*supabase/.env.local*' '*test_fotos*' )
echo "Paket lengkap dibuat: $OUT"
echo "Paket folder karya dibuat: $OUT_CODE"
unzip -l "$OUT" | tail -3
