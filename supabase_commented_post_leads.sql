-- One owned CRM lead per commented post and staff account.
-- Run after supabase_schema.sql and supabase_ai_reply_suggestions.sql
-- on both existing and new Supabase projects.

create extension if not exists pgcrypto;

delete from public.leads older
using public.leads newer
where older.id < newer.id
  and older.lead_key is not null
  and older.lead_key = newer.lead_key;

drop index if exists public.leads_lead_key_uidx;
create unique index leads_lead_key_uidx
  on public.leads (lead_key);

-- Backfill successful history. The stable key matches the application key:
-- one lead for each platform + post + staff account.
with successful_comments as (
  select distinct on (platform, log.post_id, log.staff_id)
    log.*,
    platform,
    encode(
      digest(
        'commented_post|' || platform || '|' || log.post_id || '|' || log.staff_id,
        'sha1'
      ),
      'hex'
    ) as stable_lead_key,
    coalesce(nullif(seen.author_name, ''), 'Ẩn danh') as customer_name,
    coalesce(
      nullif(seen.message, ''),
      'Bài viết đã được nhân sự bình luận và cần Sale chăm sóc.'
    ) as customer_need
  from public.comment_logs log
  cross join lateral (
    select case
      when lower(coalesce(log.group_id, '')) = 'tiktok'
        or lower(log.post_id) like 'tiktok_%'
      then 'tiktok'
      else 'facebook'
    end as platform
  ) source
  left join public.seen_posts seen on seen.post_id = log.post_id
  where log.status = 'success'
    and nullif(log.post_id, '') is not null
    and nullif(log.staff_id, '') is not null
  order by platform, log.post_id, log.staff_id, log.created_at desc, log.id desc
)
insert into public.leads (
  lead_key,
  platform,
  lead_source,
  source_id,
  post_id,
  group_id,
  post_url,
  comment_id,
  customer_name,
  customer_phone,
  phones,
  customer_need,
  intent,
  contact_status,
  confidence,
  evidence,
  raw_lead,
  created_by_staff_id,
  created_by_staff_name,
  created_by_staff_username,
  created_at,
  updated_at
)
select
  stable_lead_key,
  platform,
  'commented_post',
  log.post_id,
  log.post_id,
  log.group_id,
  log.post_url,
  log.comment_id,
  customer_name,
  null,
  '[]'::jsonb,
  customer_need,
  'staff_commented_post',
  'no_phone',
  0.6,
  left(customer_need, 300),
  jsonb_build_object(
    'lead_key', stable_lead_key,
    'platform', platform,
    'source', 'commented_post',
    'source_id', log.post_id,
    'post_id', log.post_id,
    'group_id', coalesce(log.group_id, ''),
    'post_url', coalesce(log.post_url, ''),
    'comment_id', coalesce(log.comment_id, ''),
    'name', customer_name,
    'comment_author', customer_name,
    'comment_text', coalesce(log.comment_text, ''),
    'phone', '',
    'phones', '[]'::jsonb,
    'need', customer_need,
    'evidence', left(customer_need, 300),
    'intent', 'staff_commented_post',
    'contact_status', 'no_phone',
    'confidence', 0.6,
    'processed_at', log.created_at,
    'processed_by', coalesce(nullif(log.staff_name, ''), nullif(log.staff_username, ''), 'Nhân sự'),
    'processed_by_staff_id', log.staff_id,
    'assigned_sale', coalesce(nullif(log.staff_name, ''), nullif(log.staff_username, ''), 'Nhân sự'),
    'crm_status', 'Lead mới',
    'created_at', log.created_at
  ),
  log.staff_id,
  log.staff_name,
  log.staff_username,
  log.created_at,
  now()
from successful_comments log
on conflict (lead_key) do update
set
  comment_id = excluded.comment_id,
  post_url = excluded.post_url,
  customer_name = excluded.customer_name,
  customer_need = excluded.customer_need,
  raw_lead = excluded.raw_lead,
  created_by_staff_id = excluded.created_by_staff_id,
  created_by_staff_name = excluded.created_by_staff_name,
  created_by_staff_username = excluded.created_by_staff_username,
  updated_at = now();

delete from public.leads older
using public.leads newer
where older.id < newer.id
  and older.lead_source = 'commented_post'
  and newer.lead_source = 'commented_post'
  and older.platform is not distinct from newer.platform
  and older.post_id is not distinct from newer.post_id
  and older.created_by_staff_id is not distinct from newer.created_by_staff_id;

create unique index if not exists leads_commented_post_owner_uidx
  on public.leads (lead_source, platform, post_id, created_by_staff_id)
  where lead_source = 'commented_post'
    and post_id is not null
    and created_by_staff_id is not null;

create index if not exists leads_created_by_staff_id_idx
  on public.leads (created_by_staff_id, updated_at desc);

notify pgrst, 'reload schema';
