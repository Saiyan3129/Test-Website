-- contact_submissions: stores form submissions from the website's contact form.
--
-- Run this in Supabase Dashboard → SQL Editor → New query → Run.
-- Reply status workflow: pending → replied (or → archived / spam).

create table if not exists public.contact_submissions (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  name          text not null,
  email         text not null,
  message       text not null,
  newsletter    boolean not null default false,
  reply_status  text not null default 'pending'
                check (reply_status in ('pending', 'replied', 'archived', 'spam')),
  ip            text,
  user_agent    text
);

create index if not exists contact_submissions_created_at_idx
  on public.contact_submissions (created_at desc);

create index if not exists contact_submissions_reply_status_idx
  on public.contact_submissions (reply_status);

-- Lock the table down. The Express backend uses the service_role key,
-- which bypasses RLS, so writes from the API still work. Anon/public clients
-- cannot read or write directly.
alter table public.contact_submissions enable row level security;