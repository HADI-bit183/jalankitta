-- ==============================================================================
-- JalanKitta — Skema Supabase (RLS, view publik, storage)
-- AMAN DIJALANKAN BERULANG: semua policy di-drop lalu dibuat ulang, view dibuat
-- ulang, backfill hanya jalan saat kolom pertama dibuat.
--
-- Prinsip keamanan:
--   * Tabel laporan_warga TIDAK dapat dibaca publik. Publik membaca lewat view
--     laporan_publik (nama disamarkan, tanpa user_id, status whitelist: diverifikasi, diproses, selesai).
--   * Laporan baru berstatus 'baru' (menunggu verifikasi admin) dan tidak tampil
--     di peta publik sampai admin mengubah statusnya.
--   * Pelapor tidak bisa memverifikasi laporannya sendiri (insert wajib 'baru').
--   * Admin hanya boleh mengubah kolom status, asosiasi ruas, dan soft-delete (dijaga trigger).
--
-- Jika memakai proyek Supabase lain, ganti host pada constraint foto_url_valid.
-- ==============================================================================

-- 0. EKSTENSI POSTGIS (Kalkulasi Spasial Skala Provinsi) -----------------------
create extension if not exists postgis;

-- 1. ADMINS & is_admin() -------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

drop policy if exists "admin lihat diri sendiri" on public.admins;
drop policy if exists "Admins: user dapat melihat status admin sendiri atau jika admin" on public.admins;
drop policy if exists "Admins: hanya admin yang dapat memodifikasi daftar admin" on public.admins;
create policy "admin lihat diri sendiri" on public.admins
  for select to authenticated using (user_id = auth.uid());
-- Tidak ada policy insert/update/delete: admin ditambah lewat SQL Editor saja.

-- 2. RUAS JALAN (dibuat sebelum laporan_warga agar foreign key valid di DB baru) -
create table if not exists public.ruas_jalan (
  id            text primary key default gen_random_uuid()::text,
  nama          text not null check (char_length(nama) <= 150),
  kabupaten     text not null,
  kondisi_dasar text not null default 'baik' check (kondisi_dasar in ('baik','ringan','berat')),
  kondisi       text not null check (kondisi in ('baik','ringan','berat')),
  geometry      jsonb not null,
  panjang_km    numeric(8,2),
  updated_at    timestamptz default now()
);

-- Kolom kondisi_dasar untuk tabel lama dengan backfill jujur dari kolom kondisi yang sudah ada
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ruas_jalan' and column_name = 'kondisi_dasar'
  ) then
    alter table public.ruas_jalan add column kondisi_dasar text;
    update public.ruas_jalan set kondisi_dasar = coalesce(kondisi, 'baik');
    alter table public.ruas_jalan alter column kondisi_dasar set not null;
    alter table public.ruas_jalan alter column kondisi_dasar set default 'baik';
    alter table public.ruas_jalan add constraint kondisi_dasar_check check (kondisi_dasar in ('baik','ringan','berat'));
  end if;
end $$;

-- Pastikan semua baris lama yang memiliki kondisi_dasar null terisi dari kolom kondisi
update public.ruas_jalan set kondisi_dasar = coalesce(kondisi, 'baik') where kondisi_dasar is null;

-- Migrasi jika tabel lama memakai id bigint/identity (tanpa menghapus data)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ruas_jalan'
      and column_name = 'id' and data_type <> 'text'
  ) then
    alter table public.ruas_jalan alter column id drop identity if exists;
    alter table public.ruas_jalan alter column id type text using id::text;
    alter table public.ruas_jalan alter column id set default gen_random_uuid()::text;
  end if;
end $$;
alter table public.ruas_jalan add column if not exists updated_at timestamptz default now();

alter table public.ruas_jalan enable row level security;
drop policy if exists "publik baca ruas" on public.ruas_jalan;
drop policy if exists "admin kelola ruas" on public.ruas_jalan;
drop policy if exists "Ruas Jalan: dapat dibaca oleh publik" on public.ruas_jalan;
drop policy if exists "Ruas Jalan: hanya admin yang dapat mengubah" on public.ruas_jalan;
create policy "publik baca ruas" on public.ruas_jalan
  for select to anon, authenticated using (true);
create policy "admin kelola ruas" on public.ruas_jalan
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 3. LAPORAN WARGA ---------------------------------------------------------------
create table if not exists public.laporan_warga (
  id                bigint generated always as identity primary key,
  user_id           uuid default auth.uid() references auth.users(id) on delete set null,
  nama              text not null,
  kategori_rusak    text not null,
  koordinat_lat     double precision not null,
  koordinat_lng     double precision not null,
  deskripsi         text,
  foto_url          text,
  status            text not null default 'baru',
  status_changed_at timestamptz default now(),
  ruas_id           text references public.ruas_jalan(id) on delete set null,
  deleted_at        timestamptz default null,
  created_at        timestamptz not null default now()
);

-- Untuk tabel lama yang belum punya kolom-kolom ini
alter table public.laporan_warga add column if not exists user_id uuid default auth.uid() references auth.users(id) on delete set null;
alter table public.laporan_warga add column if not exists status  text not null default 'baru';
alter table public.laporan_warga add column if not exists ruas_id text references public.ruas_jalan(id) on delete set null;
alter table public.laporan_warga add column if not exists deleted_at timestamptz default null;

-- Migrasi satu kali untuk upgrade dari versi yang kolomnya sempat dibuat dengan default 'baik':
-- Hanya mengisi ruas yang belum pernah disurvei (kondisi_dasar masih 'baik' bawaan default),
-- kolom kondisi terdata <> 'baik', dan TIDAK sedang memiliki laporan aktif diverifikasi/diproses.
-- Ini diletakkan di sini agar tabel laporan_warga dan kolom ruas_id sudah dipastikan ada.
update public.ruas_jalan r
set kondisi_dasar = r.kondisi
where r.kondisi_dasar = 'baik'
  and r.kondisi <> 'baik'
  and not exists (
    select 1 from public.laporan_warga l
    where l.ruas_id = r.id
      and l.deleted_at is null
      and l.status in ('diverifikasi', 'diproses')
  );

-- status_changed_at: backfill jujur HANYA saat kolom pertama kali dibuat
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'laporan_warga' and column_name = 'status_changed_at'
  ) then
    alter table public.laporan_warga add column status_changed_at timestamptz default now();
    update public.laporan_warga set status_changed_at = created_at where status = 'baru';
    update public.laporan_warga set status_changed_at = null       where status <> 'baru';
  end if;
end $$;

-- Constraint (NOT VALID: data lama tidak diperiksa ulang, baris baru wajib lolos)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'status_valid' and conrelid = 'public.laporan_warga'::regclass) then
    alter table public.laporan_warga add constraint status_valid
      check (status in ('baru','diverifikasi','diproses','selesai')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'kategori_valid'
      and conrelid = 'public.laporan_warga'::regclass
      and pg_get_constraintdef(oid) like '%baik%'
  ) then
    alter table public.laporan_warga drop constraint if exists kategori_valid;
    alter table public.laporan_warga add constraint kategori_valid
      check (kategori_rusak in ('baik','ringan','berat')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'panjang_valid' and conrelid = 'public.laporan_warga'::regclass) then
    alter table public.laporan_warga add constraint panjang_valid
      check (char_length(nama) <= 100 and char_length(coalesce(deskripsi, '')) <= 1000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'foto_url_valid' and conrelid = 'public.laporan_warga'::regclass) then
    alter table public.laporan_warga add constraint foto_url_valid
      check (foto_url is null or foto_url like 'https://dhepuekkghkwczebhjfs.supabase.co/storage/v1/object/public/foto_laporan/%') not valid;
  end if;
end $$;

-- ---------------------------------------------------------------
-- Constraint: koordinat harus berada dalam batas wilayah Lampung
-- (latitude: -6.25 .. -3.70, longitude: 103.55 .. 106.25)
-- Not VALID ensures existing rows are not re‑checked.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'koordinat_lampung'
      AND conrelid = 'public.laporan_warga'::regclass
  ) THEN
    ALTER TABLE public.laporan_warga ADD CONSTRAINT koordinat_lampung
      CHECK (
        koordinat_lat BETWEEN -6.25 AND -3.70 AND
        koordinat_lng BETWEEN 103.55 AND 106.25
      ) NOT VALID;
  END IF;
END $$;

-- Sisa skema lama (jika pernah dijalankan): trigger updated_at dan check inline
-- yang membolehkan status 'menunggu'/'ditolak' yang tidak dipakai aplikasi
drop trigger if exists trigger_laporan_updated_at on public.laporan_warga;
alter table public.laporan_warga drop constraint if exists laporan_warga_status_check;
alter table public.laporan_warga drop constraint if exists laporan_warga_kategori_rusak_check;

-- Trigger 1: admin hanya boleh mengubah kolom status, kategori_rusak, ruas_id, dan soft-delete
create or replace function public.cegah_ubah_kolom_laporan()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Kunci transaksi baris spesifik (Advisory Xact Lock) untuk mencegah race condition update paralel
  perform pg_advisory_xact_lock(hashtext('laporan_update_' || old.id::text));

  if (new.id <> old.id)
     or (new.nama           is distinct from old.nama)
     or (new.koordinat_lat  is distinct from old.koordinat_lat)
     or (new.koordinat_lng  is distinct from old.koordinat_lng)
     or (new.deskripsi      is distinct from old.deskripsi)
     or (new.created_at     is distinct from old.created_at)
     or ((new.foto_url is distinct from old.foto_url) and not (new.deleted_at is not null and new.foto_url is null and public.is_admin())) then
    raise exception 'Integritas data dilindungi: data laporan asli tidak boleh diubah.';
  end if;

  -- kategori_rusak hanya boleh diubah oleh admin (saat verifikasi atau menerapkan rekomendasi triase AI)
  if (new.kategori_rusak is distinct from old.kategori_rusak) and not public.is_admin() then
    raise exception 'Integritas data dilindungi: hanya admin yang dapat mengubah kategori kerusakan laporan.';
  end if;

  -- ruas_id hanya boleh diubah oleh admin
  if (new.ruas_id is distinct from old.ruas_id) and not public.is_admin() then
    raise exception 'Integritas data dilindungi: hanya admin yang dapat mengubah asosiasi ruas jalan.';
  end if;

  -- user_id permanen, tidak boleh diubah atau dipalsukan.
  -- Pengecualian: pengosongan ke NULL saat akun pengguna dihapus dari auth.users (cascade ON DELETE SET NULL)
  if (new.user_id is distinct from old.user_id) then
    if new.user_id is null and (pg_trigger_depth() > 1 or not exists (select 1 from auth.users where id = old.user_id)) then
      null; -- Diizinkan: sistem menullkan referensi karena user dihapus
    else
      raise exception 'Integritas data dilindungi: user_id tidak boleh diubah atau dipalsukan.';
    end if;
  end if;

  return new;
end;
$$;
drop trigger if exists trg_cegah_ubah_kolom_laporan on public.laporan_warga;
create trigger trg_cegah_ubah_kolom_laporan
  before update on public.laporan_warga
  for each row execute function public.cegah_ubah_kolom_laporan();

-- Trigger 2: status_changed_at hanya berubah saat status berubah (tak bisa diisi manual)
create or replace function public.set_status_changed_at()
returns trigger
language plpgsql
as $$
begin
  new.status_changed_at := case
    when new.status is distinct from old.status then now()
    else old.status_changed_at
  end;
  return new;
end;
$$;
drop trigger if exists trg_status_changed_at on public.laporan_warga;
create trigger trg_status_changed_at
  before update on public.laporan_warga
  for each row execute function public.set_status_changed_at();

-- Trigger 3: cegah pemalsuan waktu created_at saat insert
create or replace function public.set_laporan_created_at()
returns trigger
language plpgsql
as $$
begin
  new.created_at := now();
  new.status_changed_at := now();
  return new;
end;
$$;
drop trigger if exists trg_laporan_created_at on public.laporan_warga;
create trigger trg_laporan_created_at
  before insert on public.laporan_warga
  for each row execute function public.set_laporan_created_at();

-- RLS laporan_warga: TIDAK ada akses baca untuk publik/anon
alter table public.laporan_warga enable row level security;

drop policy if exists "baca terverifikasi" on public.laporan_warga;
drop policy if exists "baca milik sendiri" on public.laporan_warga;
drop policy if exists "admin baca semua" on public.laporan_warga;
drop policy if exists "insert login" on public.laporan_warga;
drop policy if exists "admin ubah status" on public.laporan_warga;
drop policy if exists "admin hapus" on public.laporan_warga;
drop policy if exists "Laporan Warga: baca laporan publik atau laporan milik sendiri atau admin" on public.laporan_warga;
drop policy if exists "Laporan Warga: user login dapat mengirim laporan" on public.laporan_warga;
drop policy if exists "Laporan Warga: hanya admin yang dapat update status/data" on public.laporan_warga;
drop policy if exists "Laporan Warga: hanya admin yang dapat menghapus" on public.laporan_warga;

create policy "baca milik sendiri" on public.laporan_warga
  for select to authenticated using (auth.uid() = user_id and deleted_at is null);
create policy "admin baca semua" on public.laporan_warga
  for select to authenticated using (public.is_admin());
create policy "insert login" on public.laporan_warga
  for insert to authenticated with check (auth.uid() = user_id and status = 'baru');
create policy "admin ubah status" on public.laporan_warga
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin hapus" on public.laporan_warga
  for delete to authenticated using (public.is_admin());
drop policy if exists "pelapor hapus laporan baru milik sendiri" on public.laporan_warga;
create policy "pelapor hapus laporan baru milik sendiri" on public.laporan_warga
  for delete to authenticated using (auth.uid() = user_id and status = 'baru');

-- 4. VIEW PUBLIK -----------------------------------------------------------------
-- Dibuat ulang (drop cascade) agar kolom lama pasti hilang dan fungsi dependen
-- (seperti get_laporan_viewport) di-refresh tanpa error dependency.
-- View berjalan dengan hak pemilik sehingga melewati RLS tabel: sengaja, karena
-- hanya memuat kolom aman. Peringatan Advisor "Security Definer View" boleh diabaikan.
drop view if exists public.laporan_publik cascade;
create view public.laporan_publik as
select
  id,
  case
    when position(' ' in trim(nama)) > 0
      then split_part(regexp_replace(trim(nama), '\s+', ' ', 'g'), ' ', 1) || ' ' || upper(left(split_part(regexp_replace(trim(nama), '\s+', ' ', 'g'), ' ', 2), 1)) || '.'
    when position('@' in trim(nama)) > 0
      then left(split_part(trim(nama), '@', 1), 3) || '***'
    else left(trim(nama), 3) || '***'
  end as nama,
  kategori_rusak,
  koordinat_lat,
  koordinat_lng,
  deskripsi,
  foto_url,
  status,
  ruas_id,
  created_at
from public.laporan_warga
where status in ('diverifikasi','diproses','selesai')
  and deleted_at is null;
grant select on public.laporan_publik to anon, authenticated;

drop view if exists public.statistik_publik cascade;
create view public.statistik_publik as
select
  count(*) filter (where status in ('diverifikasi','diproses','selesai') and deleted_at is null) as total_publik,
  count(*) filter (where status = 'selesai' and deleted_at is null) as selesai,
  round((avg(extract(epoch from (status_changed_at - created_at)) / 86400)
         filter (where status = 'selesai' and status_changed_at is not null and deleted_at is null))::numeric, 1) as rata_hari_selesai
from public.laporan_warga;
grant select on public.statistik_publik to anon, authenticated;

-- 5. SUBSCRIBERS -------------------------------------------------------------------
create table if not exists public.subscribers (
  id         bigint generated by default as identity primary key,
  email      text unique not null,
  created_at timestamptz default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'email_valid' and conrelid = 'public.subscribers'::regclass) then
    alter table public.subscribers add constraint email_valid
      check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') not valid;
  end if;
end $$;
alter table public.subscribers enable row level security;
drop policy if exists "insert public subscriber" on public.subscribers;
drop policy if exists "admin baca subscribers" on public.subscribers;
drop policy if exists "Subscribers: publik dapat mendaftarkan email" on public.subscribers;
drop policy if exists "Subscribers: hanya admin yang dapat melihat daftar email" on public.subscribers;
create policy "insert public subscriber" on public.subscribers
  for insert to anon, authenticated with check (true);
create policy "admin baca subscribers" on public.subscribers
  for select to authenticated using (public.is_admin());

-- 6. STORAGE: bucket foto_laporan ---------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('foto_laporan', 'foto_laporan', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = true, file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Upload authenticated foto_laporan" on storage.objects;
drop policy if exists "Public view foto_laporan" on storage.objects;
drop policy if exists "foto_laporan baca publik" on storage.objects;
drop policy if exists "foto_laporan upload login" on storage.objects;
drop policy if exists "foto_laporan hapus pemilik atau admin" on storage.objects;
drop policy if exists "Storage: foto_laporan publik dapat dilihat siapa saja" on storage.objects;
drop policy if exists "Storage: user login dapat mengunggah foto laporan" on storage.objects;
drop policy if exists "Storage: admin dapat menghapus foto laporan" on storage.objects;
drop policy if exists "foto_laporan baca pemilik atau admin" on storage.objects;

-- Baca: publik dapat membaca foto di bucket foto_laporan
create policy "foto_laporan baca publik" on storage.objects
  for select to anon, authenticated using (bucket_id = 'foto_laporan');

-- Upload: pengguna terautentikasi WAJIB mengunggah ke namespace folder sendiri: laporan/<auth.uid()>/...
-- Kebocoran folder dicegah dengan menghapus opsi null pada path pengguna
create policy "foto_laporan upload login" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'foto_laporan'
    and (storage.foldername(name))[1] = 'laporan'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Hapus: pemilik file (user_id di path/owner) atau admin dapat menghapus file
create policy "foto_laporan hapus pemilik atau admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'foto_laporan'
    and (owner_id = auth.uid()::text or (storage.foldername(name))[2] = auth.uid()::text or public.is_admin())
  );

-- 7. RUAS JALAN ------------------------------------------------------------------------
-- Data ruas jalan nyata diimpor melalui berkas SQL hasil scripts/import_ruas.mjs
-- (misal: supabase/ruas_real.sql).

-- 8. PENGUATAN KEAMANAN (idempoten) ---------------------------------------------------
-- 8a. Kolom nama dikunci di server: nama diambil dari token login (bukan kiriman klien),
--     sehingga tidak bisa dipalsukan lewat API langsung. Catatan: full_name berasal dari
--     metadata profil pengguna sendiri; jika tidak ada, dipakai email (disamarkan view publik).
create or replace function public.set_laporan_nama()
returns trigger
language plpgsql
as $$
declare
  v_nama text;
begin
  v_nama := nullif(trim(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', '')), '');
  new.nama := left(coalesce(v_nama, auth.jwt() ->> 'email', 'Warga'), 100);
  return new;
end;
$$;
drop trigger if exists trg_laporan_nama on public.laporan_warga;
create trigger trg_laporan_nama
  before insert on public.laporan_warga
  for each row execute function public.set_laporan_nama();

-- 8b. Ruas ID dikunci dan dihitung secara otoritatif di server:
-- 8b. Ruas ID dikunci dan dihitung secara otoritatif di server:
--     Menggunakan PostGIS spatial ST_DWithin & ST_Distance (didukung indeks GIST),
--     dengan fallback algoritma iterasi koordinat jika PostGIS belum terpasang.
create or replace function public.cari_ruas_terdekat(p_lat double precision, p_lng double precision)
returns text
language plpgsql
stable
as $$
declare
  v_best_id text;
  r record;
  v_min_dist double precision := 1e10;
  v_coord jsonb;
  v_dist double precision;
  v_c_lng double precision;
  v_c_lat double precision;
  v_dlat double precision;
  v_dlng double precision;
begin
  if p_lat is null or p_lng is null then
    return null;
  end if;

  -- 1. Evaluasi Cepat PostGIS (O(log N) melalui indeks spasial GIST)
  begin
    select r.id into v_best_id
    from public.ruas_jalan r
    where st_dwithin(
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      st_setsrid(st_geomfromgeojson(r.geometry::text), 4326)::geography,
      10000 -- toleransi radius 10 km
    )
    order by st_distance(
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      st_setsrid(st_geomfromgeojson(r.geometry::text), 4326)::geography
    ) asc
    limit 1;

    if v_best_id is not null then
      return v_best_id;
    end if;
  exception when others then
    -- Fallback halus jika fungsi geografi PostGIS belum terpasang
    null;
  end;

  -- 2. Fallback Algoritma Geometrik (Kompatibel dengan DB polos tanpa PostGIS)
  for r in select id, geometry from public.ruas_jalan loop
    if r.geometry ->> 'type' = 'LineString' and jsonb_typeof(r.geometry -> 'coordinates') = 'array' then
      for v_coord in select * from jsonb_array_elements(r.geometry -> 'coordinates') loop
        v_c_lng := (v_coord ->> 0)::double precision;
        v_c_lat := (v_coord ->> 1)::double precision;
        v_dlat := (v_c_lat - p_lat) * 111.0;
        v_dlng := (v_c_lng - p_lng) * 111.0 * cos(radians(p_lat));
        v_dist := sqrt(v_dlat * v_dlat + v_dlng * v_dlng);
        if v_dist < v_min_dist then
          v_min_dist := v_dist;
          v_best_id := r.id;
        end if;
      end loop;
    end if;
  end loop;

  if v_min_dist <= 10.0 then
    return v_best_id;
  end if;
  return null;
end;
$$;

create or replace function public.set_laporan_ruas_id()
returns trigger
language plpgsql
as $$
begin
  -- Ruas ID dihitung secara otoritatif di server berdasarkan koordinat gps,
  -- kiriman client diabaikan untuk mencegah pemalsuan ruas_id
  new.ruas_id := public.cari_ruas_terdekat(new.koordinat_lat, new.koordinat_lng);
  return new;
end;
$$;
drop trigger if exists trg_laporan_ruas_id on public.laporan_warga;
create trigger trg_laporan_ruas_id
  before insert on public.laporan_warga
  for each row execute function public.set_laporan_ruas_id();

-- 8c. Batas laporan harian per pengguna DINONAKTIFKAN (tanpa batas kuota).
-- Fungsi tetap dipertahankan hanya untuk advisory xact lock agar insert paralel di titik identik tidak race.
create or replace function public.batasi_laporan_harian()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is not null then
    perform pg_advisory_xact_lock(hashtext(new.user_id::text));
  end if;

  -- Kunci transaksi spasial per petak 10 meter untuk mencegah race condition insert paralel di titik identik
  perform pg_advisory_xact_lock(hashtext('geo_' || round(new.koordinat_lat::numeric, 4)::text || '_' || round(new.koordinat_lng::numeric, 4)::text));

  return new;
end;
$$;
drop trigger if exists trg_batasi_laporan_harian on public.laporan_warga;
create trigger trg_batasi_laporan_harian
  before insert on public.laporan_warga
  for each row execute function public.batasi_laporan_harian();

-- 8d. Batas pendaftaran subscriber: maks. 200 baris baru per jam (seluruh sistem)
--     untuk meredam spam dari anon key publik.
create or replace function public.batasi_subscriber()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.subscribers where created_at > now() - interval '1 hour') >= 200 then
    raise exception 'Batas pendaftaran subscriber per jam tercapai.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_batasi_subscriber on public.subscribers;
create trigger trg_batasi_subscriber
  before insert on public.subscribers
  for each row execute function public.batasi_subscriber();

-- 8e. Indeks untuk optimasi query skala provinsi, RLS, dan pencarian spasial
create index if not exists idx_laporan_warga_user_created on public.laporan_warga(user_id, created_at desc);
create index if not exists idx_laporan_warga_status on public.laporan_warga(status);
create index if not exists idx_laporan_warga_created_at on public.laporan_warga(created_at desc);
create index if not exists idx_laporan_warga_ruas_id on public.laporan_warga(ruas_id);
create index if not exists idx_laporan_warga_deleted_at on public.laporan_warga(deleted_at);
create index if not exists idx_subscribers_created on public.subscribers(created_at desc);

-- Indeks Spasial PostGIS (GIST) untuk efisiensi kueri radius dan Bounding-Box ratusan ribu baris data
do $$
begin
  -- Indeks GIST koordinat titik laporan warga
  if exists (select 1 from pg_proc where proname = 'st_makepoint') then
    execute 'create index if not exists idx_laporan_warga_geom_gist on public.laporan_warga using gist (st_setsrid(st_makepoint(koordinat_lng, koordinat_lat), 4326))';
    execute 'create index if not exists idx_ruas_jalan_geom_gist on public.ruas_jalan using gist (st_setsrid(st_geomfromgeojson(geometry::text), 4326))';
  end if;
exception when others then
  null;
end $$;

-- 8f. Audit Log Admin untuk tindakan penting (hapus laporan, soft-delete, ubah status)
create table if not exists public.laporan_audit_log (
  id          bigint generated always as identity primary key,
  laporan_id  text,
  action      text not null, -- 'DELETE', 'SOFT_DELETE', 'STATUS_CHANGE'
  admin_id    uuid default auth.uid() references auth.users(id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);

-- Migrasi idempoten: pastikan kolom laporan_id bertipe text agar kompatibel dengan UUID laporan
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'laporan_audit_log'
      and column_name = 'laporan_id'
      and data_type in ('bigint', 'integer', 'smallint')
  ) then
    alter table public.laporan_audit_log alter column laporan_id type text using laporan_id::text;
  end if;
end $$;

alter table public.laporan_audit_log enable row level security;
drop policy if exists "admin baca audit log" on public.laporan_audit_log;
create policy "admin baca audit log" on public.laporan_audit_log
  for select to authenticated using (public.is_admin());

create or replace function public.log_laporan_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (TG_OP = 'DELETE') then
    insert into public.laporan_audit_log (laporan_id, action, admin_id, data)
    values (old.id, 'DELETE', auth.uid(), to_jsonb(old));
    return old;
  elsif (TG_OP = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null) then
    insert into public.laporan_audit_log (laporan_id, action, admin_id, data)
    values (new.id, 'SOFT_DELETE', auth.uid(), jsonb_build_object('deleted_at', new.deleted_at));
    return new;
  elsif (TG_OP = 'UPDATE' and new.status is distinct from old.status) then
    insert into public.laporan_audit_log (laporan_id, action, admin_id, data)
    values (new.id, 'STATUS_CHANGE', auth.uid(), jsonb_build_object('old_status', old.status, 'new_status', new.status));
    return new;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_log_laporan_audit on public.laporan_warga;
create trigger trg_log_laporan_audit
  after update or delete on public.laporan_warga
  for each row execute function public.log_laporan_audit();

-- 8g. Kuota unggah foto per akun: maks. 30 file aktif di folder laporan/<uid>/
--     Mencegah eksploitasi unggahan file tanpa batas via API langsung sebelum laporan dibuat.
--     Dilengkapi advisory lock untuk mencegah race upload paralel.
create or replace function public.batasi_kuota_upload_foto()
returns trigger
language plpgsql
security definer
as $$
declare
  v_count integer;
  v_uid   text;
begin
  if new.bucket_id = 'foto_laporan' then
    v_uid := (storage.foldername(new.name))[2];
    -- Hitung file pada folder pengguna bersangkutan (admin/service_role bebas batas)
    if v_uid is not null and not public.is_admin() then
      perform pg_advisory_xact_lock(hashtext('upload_' || v_uid));
      select count(*) into v_count
      from storage.objects
      where bucket_id = 'foto_laporan'
        and (storage.foldername(name))[1] = 'laporan'
        and (storage.foldername(name))[2] = v_uid;

      if v_count >= 30 then
        raise exception 'Batas kuota penyimpanan foto tercapai (maksimal 30 file aktif per akun). Hapus laporan lama untuk mengunggah kembali.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Pasang trigger storage.objects secara aman:
-- Jika role postgres di Supabase tidak diizinkan membuat trigger di storage.objects,
-- skrip TIDAK AKAN membatalkan transaksi.
do $$
begin
  drop trigger if exists trg_batasi_kuota_upload on storage.objects;
  create trigger trg_batasi_kuota_upload
    before insert on storage.objects
    for each row execute function public.batasi_kuota_upload_foto();
exception
  when insufficient_privilege then
    raise notice 'Trigger kuota pada storage.objects dilewati karena batasan hak akses role postgres pada instance ini.';
  when others then
    raise notice 'Pemasangan trigger storage.objects dilewati: %', SQLERRM;
end $$;

-- 8h. Sinkronisasi kondisi ruas jalan dari laporan terverifikasi
--     Aturan penentuan kondisi ruas:
--     - Menggunakan kondisi terparah antara kondisi_dasar survei dan laporan aktif:
--       * Jika ada laporan aktif diverifikasi/diproses 'berat' => 'berat'
--       * Jika ada laporan aktif diverifikasi/diproses 'ringan':
--         - Jika kondisi_dasar 'berat', TETAP 'berat' (laporan ringan tidak menurunkan status ruas berat!)
--         - Jika kondisi_dasar 'baik', menjadi 'ringan'
--       * Jika tidak ada laporan aktif rusak (semua selesai/baik) => kembali ke kondisi_dasar ruas
-- Bersihkan overload fungsi versi lama (tanpa parameter) agar tidak tertinggal dengan hak akses PUBLIC
drop function if exists public.sinkron_kondisi_ruas();
drop function if exists public.sinkron_kondisi_ruas(text);

create or replace function public.sinkron_kondisi_ruas(p_ruas_id text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_kondisi text;
begin
  -- Keamanan: Jika dipanggil langsung lewat RPC eksternal (depth = 0), wajib berstatus admin!
  -- Pengecualian: pemanggilan internal melalui trigger (pg_trigger_depth() > 0),
  -- atau sesi konsol SQL Editor/superuser (session_user = 'postgres'), atau backend service_role
  if pg_trigger_depth() = 0 and not (
    public.is_admin()
    or session_user in ('postgres', 'supabase_admin')
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
  ) then
    raise exception 'Akses ditolak: hanya admin yang dapat memicu sinkronisasi kondisi ruas.';
  end if;

  for r in select id, kondisi_dasar from public.ruas_jalan where (p_ruas_id is null or id = p_ruas_id) loop
    select
      case
        -- Ada laporan aktif 'berat': kondisi pasti 'berat'
        when exists (
          select 1 from public.laporan_warga
          where ruas_id = r.id
            and deleted_at is null
            and status in ('diverifikasi', 'diproses')
            and kategori_rusak = 'berat'
        ) then 'berat'
        -- Ada laporan aktif 'ringan': ambil yang terparah antara 'ringan' dan kondisi_dasar
        when exists (
          select 1 from public.laporan_warga
          where ruas_id = r.id
            and deleted_at is null
            and status in ('diverifikasi', 'diproses')
            and kategori_rusak = 'ringan'
        ) then
          case when r.kondisi_dasar = 'berat' then 'berat' else 'ringan' end
        -- Tidak ada laporan aktif rusak: kembali ke kondisi_dasar survei/perbaikan
        else r.kondisi_dasar
      end
    into v_kondisi;

    update public.ruas_jalan
    set kondisi = v_kondisi, updated_at = now()
    where id = r.id and kondisi is distinct from v_kondisi;
  end loop;
end;
$$;

-- Izin: cabut akses anon dan public; hanya authenticated (yang lolos is_admin) atau trigger internal yang dapat menjalankan
revoke all on function public.sinkron_kondisi_ruas(text) from public, anon;
grant execute on function public.sinkron_kondisi_ruas(text) to authenticated;

-- 8i. Admin dapat memperbarui kondisi dasar ruas jalan (setelah survei ulang atau pekerjaan perbaikan tuntas)
drop function if exists public.perbarui_kondisi_dasar_ruas(text, text);
create or replace function public.perbarui_kondisi_dasar_ruas(p_ruas_id text, p_kondisi_baru text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.is_admin()
    or session_user in ('postgres', 'supabase_admin')
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
  ) then
    raise exception 'Akses ditolak: hanya admin yang dapat memperbarui kondisi dasar ruas.';
  end if;

  if p_kondisi_baru not in ('baik', 'ringan', 'berat') then
    raise exception 'Kondisi tidak valid: gunakan baik, ringan, atau berat.';
  end if;

  update public.ruas_jalan
  set kondisi_dasar = p_kondisi_baru, updated_at = now()
  where id = p_ruas_id;

  -- Hitung ulang kondisi efektif ruas
  perform public.sinkron_kondisi_ruas(p_ruas_id);
end;
$$;
revoke all on function public.perbarui_kondisi_dasar_ruas(text, text) from public, anon;
grant execute on function public.perbarui_kondisi_dasar_ruas(text, text) to authenticated;

-- 8j. Trigger otomatis sinkron kondisi ruas:
--     HANYA jalan saat UPDATE (status, ruas_id, kategori_rusak, deleted_at) atau DELETE.
--     TIDAK jalan saat INSERT laporan baru (status 'baru' belum diverifikasi).
create or replace function public.trg_sinkron_kondisi_ruas_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (TG_OP = 'DELETE') then
    -- Hanya sinkron jika laporan yang dihapus tadinya aktif terverifikasi/diproses
    if old.ruas_id is not null and old.status in ('diverifikasi', 'diproses') then
      perform public.sinkron_kondisi_ruas(old.ruas_id);
    end if;
    return old;
  elsif (TG_OP = 'UPDATE') then
    -- Hanya sinkron jika ada perubahan status, ruas_id, kategori_rusak, atau soft delete
    if (new.status is distinct from old.status)
       or (new.ruas_id is distinct from old.ruas_id)
       or (new.kategori_rusak is distinct from old.kategori_rusak)
       or (new.deleted_at is distinct from old.deleted_at) then
      if old.ruas_id is not null and old.ruas_id is distinct from new.ruas_id then
        perform public.sinkron_kondisi_ruas(old.ruas_id);
      end if;
      if new.ruas_id is not null then
        perform public.sinkron_kondisi_ruas(new.ruas_id);
      end if;
    end if;
    return new;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_sinkron_kondisi_ruas on public.laporan_warga;
create trigger trg_sinkron_kondisi_ruas
  after update or delete on public.laporan_warga
  for each row execute function public.trg_sinkron_kondisi_ruas_fn();

-- 8k. Kueri Spasial Skala Provinsi (PostGIS RPCs) -------------------------------

-- 8k.1 Cek Duplikasi Laporan Sekitar (Radius 30 Meter)
-- Menghindari spam laporan identik dari banyak warga di titik lubang yang sama
create or replace function public.cek_duplikat_laporan(
  p_lat double precision,
  p_lng double precision,
  p_radius_meter double precision default 30.0
)
returns table (
  id bigint,
  status text,
  jarak_meter double precision,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  return query
  select
    l.id,
    l.status,
    case
      when exists (select 1 from pg_proc where proname = 'st_distance') then
        st_distance(
          st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
          st_setsrid(st_makepoint(l.koordinat_lng, l.koordinat_lat), 4326)::geography
        )
      else
        sqrt(power((l.koordinat_lat - p_lat) * 111000.0, 2) + power((l.koordinat_lng - p_lng) * 111000.0 * cos(radians(p_lat)), 2))
    end as jarak_meter,
    l.created_at
  from public.laporan_warga l
  where l.deleted_at is null
    and l.status in ('baru', 'diverifikasi', 'diproses')
    and (
      (exists (select 1 from pg_proc where proname = 'st_dwithin') and
       st_dwithin(
         st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
         st_setsrid(st_makepoint(l.koordinat_lng, l.koordinat_lat), 4326)::geography,
         p_radius_meter
       ))
      or
      (not exists (select 1 from pg_proc where proname = 'st_dwithin') and
       sqrt(power((l.koordinat_lat - p_lat) * 111000.0, 2) + power((l.koordinat_lng - p_lng) * 111000.0 * cos(radians(p_lat)), 2)) <= p_radius_meter)
    )
  order by jarak_meter asc
  limit 3;
end;
$$;
grant execute on function public.cek_duplikat_laporan(double precision, double precision, double precision) to anon, authenticated;

-- 8k.2 Lazy-Loading Bounding-Box Viewport Peta
-- Memuat hanya titik dalam area pandang layar HP/Desktop untuk mencegah crash memori saat data mencapai ratusan ribu
create or replace function public.get_laporan_viewport(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  p_kategori text default null,
  max_limit integer default 300
)
returns setof public.laporan_publik
language sql
stable
security definer
set search_path = public, extensions
as $$
  select *
  from public.laporan_publik
  where (
    -- Operator spasial && dengan ST_MakeEnvelope untuk pemanfaatan indeks GIST instan
    (exists (select 1 from pg_proc where proname = 'st_makeenvelope') and
     st_setsrid(st_makepoint(koordinat_lng, koordinat_lat), 4326) && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326))
    or
    (not exists (select 1 from pg_proc where proname = 'st_makeenvelope') and
     koordinat_lng between min_lng and max_lng and koordinat_lat between min_lat and max_lat)
  )
  and (p_kategori is null or p_kategori = 'all' or kategori_rusak = p_kategori)
  order by created_at desc
  limit least(max_limit, 500);
$$;
grant execute on function public.get_laporan_viewport(double precision, double precision, double precision, double precision, text, integer) to anon, authenticated;

-- ==============================================================================
-- 9. TABEL: AI TRIASE (Saran AI Foto Kerusakan - Free Tier)
-- ==============================================================================
create table if not exists public.ai_triase (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  foto_path text not null,
  hasil jsonb not null,
  model text,
  created_at timestamptz default now()
);

alter table public.ai_triase enable row level security;

-- Policy: SELECT untuk pemilik (user_id = auth.uid()) dan admin (public.is_admin())
drop policy if exists "ai_triase_select_owner" on public.ai_triase;
create policy "ai_triase_select_owner" on public.ai_triase
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "ai_triase_select_admin" on public.ai_triase;
create policy "ai_triase_select_admin" on public.ai_triase
  for select to authenticated
  using (public.is_admin());

-- INSERT/UPDATE/DELETE tidak diberi policy untuk anon/authenticated (hanya service_role)

-- Index (user_id, created_at) dan (foto_path)
create index if not exists idx_ai_triase_user_created on public.ai_triase(user_id, created_at desc);
create index if not exists idx_ai_triase_foto_path on public.ai_triase(foto_path);

-- ==============================================================================
-- 10. PEMBERSIH FOTO YATIM STORAGE (Orphaned Storage Objects Helper)
-- ==============================================================================
-- Mengembalikan daftar path berkas di bucket 'foto_laporan' dengan pola 'laporan/*'
-- yang berumur > 24 jam dan tidak memiliki referensi aktif di public.laporan_warga.foto_url.
-- Penghapusan fisik berkas dilakukan oleh Edge Function bersihkan-yatim via Storage API.
create or replace function public.bersihkan_foto_yatim()
returns table(name text)
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  return query
  select o.name::text
  from storage.objects o
  where o.bucket_id = 'foto_laporan'
    and o.name like 'laporan/%'
    and o.created_at < (now() - interval '24 hours')
    and not exists (
      select 1 from public.laporan_warga lw
      where lw.foto_url is not null
        and lw.deleted_at is null
        and lw.foto_url like '%' || o.name
    );
exception
  when insufficient_privilege then
    raise warning 'Akses ditolak pada storage.objects (insufficient privilege)';
    return;
  when others then
    raise warning 'Gagal mengambil daftar foto yatim: %', sqlerrm;
    return;
end;
$$;

-- Cabut akses eksekusi dari publik dan user terotentikasi; hanya service_role yang diizinkan
revoke execute on function public.bersihkan_foto_yatim() from public, anon, authenticated;
grant execute on function public.bersihkan_foto_yatim() to service_role;

-- ==============================================================================
-- 11. MANAJEMEN ADMIN LANGSUNG DARI DASHBOARD ADMIN (SECURITY DEFINER)
-- ==============================================================================
create or replace function public.admin_list_users()
returns table(user_id uuid, email text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Akses ditolak: Hanya admin yang dapat melihat daftar administrator.';
  end if;

  return query
  select a.user_id, coalesce(u.email::text, 'Tidak ada email') as email, a.created_at
  from public.admins a
  left join auth.users u on u.id = a.user_id
  order by a.created_at asc;
end;
$$;

create or replace function public.admin_add_user(p_email text)
returns json
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_target_id uuid;
  v_cleaned_email text := lower(trim(p_email));
begin
  if not public.is_admin() then
    raise exception 'Akses ditolak: Hanya admin yang dapat menambahkan administrator baru.';
  end if;

  if v_cleaned_email is null or v_cleaned_email = '' then
    return json_build_object('ok', false, 'message', 'Email tidak boleh kosong.');
  end if;

  select id into v_target_id
  from auth.users
  where lower(email) = v_cleaned_email;

  if v_target_id is null then
    return json_build_object(
      'ok', false,
      'message', 'Pengguna dengan email ' || v_cleaned_email || ' belum terdaftar. Pengguna harus register / login terlebih dahulu ke JalanKitta.'
    );
  end if;

  insert into public.admins (user_id)
  values (v_target_id)
  on conflict (user_id) do nothing;

  return json_build_object(
    'ok', true,
    'message', 'Berhasil menambahkan ' || v_cleaned_email || ' sebagai administrator!'
  );
end;
$$;

create or replace function public.admin_remove_user(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_total_admins int;
begin
  if not public.is_admin() then
    raise exception 'Akses ditolak: Hanya admin yang dapat mencabut akses administrator.';
  end if;

  select count(*) into v_total_admins from public.admins;
  if v_total_admins <= 1 then
    return json_build_object(
      'ok', false,
      'message', 'Tidak dapat menghapus admin terakhir. Sistem membutuhkan minimal 1 administrator aktif.'
    );
  end if;

  delete from public.admins where user_id = p_user_id;

  return json_build_object(
    'ok', true,
    'message', 'Hak akses administrator berhasil dicabut.'
  );
end;
$$;

grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_add_user(text) to authenticated;
grant execute on function public.admin_remove_user(uuid) to authenticated;

-- ==============================================================================
-- ADMIN PERTAMA: daftar akun lewat login.html, salin UID di Authentication > Users:
--   insert into public.admins (user_id) values ('<UUID_ANDA>') on conflict do nothing;
-- ==============================================================================


