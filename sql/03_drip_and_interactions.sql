-- Drip-campaign + interaction-tracking schema.
--
-- Run this in Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to re-run: every statement uses IF [NOT] EXISTS.

-- ---------------------------------------------------------------------------
-- 1) New columns on contact_submissions
-- ---------------------------------------------------------------------------
-- newsletter_status separates the lifecycle from the boolean opt-in. The
-- existing `newsletter` column records "did they tick the box on the form"
-- (immutable, original intent). newsletter_status records where they are now:
--   pending       — opted in, but haven't confirmed via reply yet
--   subscribed    — confirmed (replied to a confirmation/drip, or otherwise)
--   unsubscribed  — clicked unsubscribe
--   bounced       — Resend reported a hard bounce (future use)
alter table public.contact_submissions
  add column if not exists newsletter_status text not null default 'pending'
    check (newsletter_status in ('pending', 'subscribed', 'unsubscribed', 'bounced'));

-- followup_step: how many drip emails this row has received (0 = none yet).
alter table public.contact_submissions
  add column if not exists followup_step int not null default 0;

-- last_followup_sent_at: timestamp of the most recent drip. Used (with
-- created_at as fallback) to decide if the next drip is due.
alter table public.contact_submissions
  add column if not exists last_followup_sent_at timestamptz;

-- unsubscribe_token: opaque random token used in unsubscribe links.
-- Per-row, unique. Generated on first send if missing.
alter table public.contact_submissions
  add column if not exists unsubscribe_token text unique;

create index if not exists contact_submissions_drip_due_idx
  on public.contact_submissions (newsletter, newsletter_status, followup_step, last_followup_sent_at);

-- ---------------------------------------------------------------------------
-- 2) contact_interactions: append-only log of every event
-- ---------------------------------------------------------------------------
-- Why a separate table instead of more columns? Because we want a full
-- timeline (multiple sends, multiple replies, etc.) and we don't want to
-- mutate the original submission row each time.
create table if not exists public.contact_interactions (
  id            bigint generated always as identity primary key,
  submission_id bigint not null references public.contact_submissions(id) on delete cascade,
  created_at    timestamptz not null default now(),
  kind          text not null check (kind in (
                  'submission_received',
                  'confirmation_sent',
                  'confirmation_failed',
                  'reply_received',
                  'subscribed',
                  'unsubscribed',
                  'followup_sent',
                  'followup_failed'
                )),
  subject       text,
  email_id      text,
  metadata      jsonb
);

create index if not exists contact_interactions_submission_id_idx
  on public.contact_interactions (submission_id);

create index if not exists contact_interactions_kind_created_at_idx
  on public.contact_interactions (kind, created_at desc);

alter table public.contact_interactions enable row level security;