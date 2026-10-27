-- ==============================================================================
-- JalanKitta — Migrasi Database Editor Admin (Supabase RPC)
-- Jalankan skrip ini di SQL Editor Supabase agar admin dapat mengelola daftar
-- administrator langsung dari Dashboard Admin tanpa harus membuka SQL Editor lagi.
-- ==============================================================================

-- 1. Fungsi Mengambil Daftar Administrator beserta Email dari auth.users
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

-- 2. Fungsi Menambahkan Admin Baru berdasarkan Email
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

-- 3. Fungsi Menghapus/Mencabut Hak Akses Admin
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

-- Berikan izin eksekusi ke authenticated user (dijaga oleh is_admin() di dalam fungsi)
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_add_user(text) to authenticated;
grant execute on function public.admin_remove_user(uuid) to authenticated;
