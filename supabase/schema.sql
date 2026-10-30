-- Readaholic database for Supabase.
-- Run this whole file once in Supabase Dashboard → SQL Editor. It is safe to run again after updates.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

create table if not exists public.books (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 300),
  author text not null default '' check (char_length(author) <= 300),
  genre text not null default '' check (char_length(genre) <= 500),
  description text not null default '' check (char_length(description) <= 5000),
  format text not null check (format in ('epub', 'pdf', 'txt', 'cbz')),
  file_path text not null,
  original_name text not null,
  size bigint not null,
  cover_path text,
  uploaded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.progress (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  book_id bigint not null references public.books (id) on delete cascade,
  location text not null default '' check (char_length(location) <= 2000),
  percent real not null default 0 check (percent between 0 and 100),
  position_label text not null default '' check (char_length(position_label) <= 200),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists progress_touch on public.progress;
create trigger progress_touch before insert or update on public.progress
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles are created automatically for every auth user.
-- The very first user becomes admin.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_username text := coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1));
begin
  insert into public.profiles (id, username, display_name, role)
  values (
    new.id,
    v_username,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), v_username),
    case when exists (select 1 from public.profiles) then 'member' else 'admin' end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.progress enable row level security;

drop policy if exists "profiles readable by members" on public.profiles;
create policy "profiles readable by members" on public.profiles
  for select to authenticated using (true);

drop policy if exists "books readable by members" on public.books;
create policy "books readable by members" on public.books
  for select to authenticated using (true);

drop policy if exists "members add books" on public.books;
create policy "members add books" on public.books
  for insert to authenticated
  with check (uploaded_by = auth.uid() and split_part(file_path, '/', 1) = auth.uid()::text);

drop policy if exists "uploader or admin edits books" on public.books;
create policy "uploader or admin edits books" on public.books
  for update to authenticated
  using (uploaded_by = auth.uid() or public.is_admin())
  with check (uploaded_by = auth.uid() or public.is_admin());

drop policy if exists "uploader or admin deletes books" on public.books;
create policy "uploader or admin deletes books" on public.books
  for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_admin());

drop policy if exists "own progress" on public.progress;
create policy "own progress" on public.progress
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Only metadata columns of a book can be edited; profiles change only through the admin functions.
revoke all on public.profiles, public.books, public.progress from anon;
revoke insert, update, delete on public.profiles from authenticated;
revoke update on public.books from authenticated;
grant select on public.profiles to authenticated;
grant select, insert, delete on public.books to authenticated;
grant update (title, author, genre, description, cover_path) on public.books to authenticated;
grant select, insert, update, delete on public.progress to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: one private bucket, each member uploads into a folder named after their user id.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('books', 'books', false)
on conflict (id) do nothing;

drop policy if exists "readaholic members read files" on storage.objects;
create policy "readaholic members read files" on storage.objects
  for select to authenticated using (bucket_id = 'books');

drop policy if exists "readaholic members upload files" on storage.objects;
create policy "readaholic members upload files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "readaholic owner or admin deletes files" on storage.objects;
create policy "readaholic owner or admin deletes files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'books' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------------------------------------------------------------------------
-- Account management (called from the Admin page, or from the SQL Editor).
-- ---------------------------------------------------------------------------
create or replace function public.assert_admin() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- The SQL Editor runs without a JWT: allow it so the owner can always manage accounts.
  if coalesce(nullif(current_setting('request.jwt.claims', true), ''), 'null') = 'null' then
    return;
  end if;
  if not public.is_admin() then
    raise exception 'Chỉ quản trị viên mới được phép' using errcode = '42501';
  end if;
end $$;

create or replace function public.check_password(p_password text) returns void
language plpgsql as $$
begin
  if p_password is null or char_length(p_password) < 6 then
    raise exception 'Mật khẩu phải có ít nhất 6 ký tự' using errcode = '22023';
  end if;
end $$;

create or replace function public.admin_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.profiles where role = 'admin';
$$;

create or replace function public.admin_create_user(
  p_username text, p_password text, p_display_name text default null, p_role text default 'member'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := gen_random_uuid();
  v_username text := lower(trim(p_username));
  v_email text;
begin
  perform public.assert_admin();
  if v_username !~ '^[a-z0-9_.-]{3,32}$' then
    raise exception 'Tên đăng nhập phải dài 3–32 ký tự, chỉ gồm chữ không dấu, số, dấu . _ -' using errcode = '22023';
  end if;
  perform public.check_password(p_password);
  if exists (select 1 from public.profiles where username = v_username) then
    raise exception 'Tên đăng nhập đã tồn tại' using errcode = '23505';
  end if;
  v_email := v_username || '@readaholic.local';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('username', v_username, 'display_name', coalesce(nullif(trim(p_display_name), ''), v_username)),
    now(), now(), '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());

  update public.profiles set role = case when p_role = 'admin' then 'admin' else 'member' end
  where id = v_id and role <> 'admin';
  return v_id;
end $$;

create or replace function public.admin_update_user(
  p_id uuid, p_display_name text default null, p_role text default null, p_password text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles;
begin
  perform public.assert_admin();
  select * into v_profile from public.profiles where id = p_id;
  if not found then
    raise exception 'Không tìm thấy người dùng' using errcode = 'P0002';
  end if;
  if p_display_name is not null then
    update public.profiles set display_name = coalesce(nullif(trim(p_display_name), ''), username) where id = p_id;
  end if;
  if p_role is not null then
    if v_profile.role = 'admin' and p_role <> 'admin' and public.admin_count() <= 1 then
      raise exception 'Phải còn ít nhất một quản trị viên' using errcode = '22023';
    end if;
    update public.profiles set role = case when p_role = 'admin' then 'admin' else 'member' end where id = p_id;
  end if;
  if p_password is not null then
    perform public.check_password(p_password);
    update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
    where id = p_id;
    -- Sign the user out of every device.
    delete from auth.sessions where user_id = p_id;
  end if;
end $$;

create or replace function public.admin_delete_user(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles;
begin
  perform public.assert_admin();
  if p_id = auth.uid() then
    raise exception 'Không thể tự xoá tài khoản của mình' using errcode = '22023';
  end if;
  select * into v_profile from public.profiles where id = p_id;
  if not found then
    raise exception 'Không tìm thấy người dùng' using errcode = 'P0002';
  end if;
  if v_profile.role = 'admin' and public.admin_count() <= 1 then
    raise exception 'Phải còn ít nhất một quản trị viên' using errcode = '22023';
  end if;
  -- Books the user contributed stay in the library (uploaded_by becomes NULL).
  delete from auth.users where id = p_id;
end $$;

revoke execute on function public.assert_admin(), public.check_password(text), public.admin_count(),
  public.admin_create_user(text, text, text, text), public.admin_update_user(uuid, text, text, text),
  public.admin_delete_user(uuid), public.handle_new_user()
  from public, anon;
grant execute on function public.admin_create_user(text, text, text, text), public.admin_update_user(uuid, text, text, text),
  public.admin_delete_user(uuid) to authenticated;
