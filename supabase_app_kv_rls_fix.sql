-- Fix lỗi 42501: new row violates row-level security policy for table "app_kv"
-- Dùng cho các mục lưu qua app_kv: ai_config, content_studio_setup, content_techniques,
-- comment_templates, comment_tags, content_pipeline...
--
-- Cách bảo mật hơn: đặt SUPABASE_SERVICE_ROLE_KEY trong backend Render/Vercel API.
-- Nếu backend chỉ đang có SUPABASE_PUBLISHABLE_KEY / SUPABASE_ANON_KEY, chạy file này
-- để anon/authenticated có thể đọc ghi app_kv như schema gốc của dự án.

create table if not exists public.app_kv (
    key        text primary key,
    value      jsonb not null,
    updated_at timestamptz not null default now()
);

create or replace function public.set_app_kv_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_app_kv_updated_at on public.app_kv;
create trigger trg_app_kv_updated_at
before update on public.app_kv
for each row
execute function public.set_app_kv_updated_at();

-- Project này dùng backend riêng. Nếu chưa dùng service role, tắt RLS cho app_kv
-- để publishable/anon key mà backend đang cầm có thể ghi được.
alter table public.app_kv disable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.app_kv to anon, authenticated, service_role;

notify pgrst, 'reload schema';

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'app_kv';
